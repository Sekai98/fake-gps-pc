package com.fakegps

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.drawable.ColorDrawable
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import androidx.core.app.NotificationCompat

/**
 * Foreground Service: aplica mock location periodicamente + mostra overlay com joystick.
 *
 * Fluxo:
 *   1. onStartCommand(ACTION_START): registra provider, cria overlay, inicia timer de updates
 *   2. Timer a 10Hz: pega lat/lon do MovementEngine, chama setTestProviderLocation
 *   3. Joystick overlay reporta input, MovementEngine integra
 *   4. onStartCommand(ACTION_STOP) ou onDestroy: limpa tudo
 */
class FakeGPSService : Service() {

    companion object {
        const val ACTION_START = "com.fakegps.ACTION_START"
        const val ACTION_STOP = "com.fakegps.ACTION_STOP"
        const val NOTIF_CHANNEL = "fake_gps_channel"
        const val NOTIF_ID = 42
        const val UPDATE_INTERVAL_MS = 100L  // 10Hz - mesmo que o Electron

        // Posicao inicial: Av. Paulista (mesmo default do Electron)
        const val START_LAT = -23.561684
        const val START_LON = -46.655981
    }

    private lateinit var windowManager: WindowManager
    private lateinit var locationManager: LocationManager
    private lateinit var engine: MovementEngine
    private lateinit var handler: Handler
    private var overlayRoot: View? = null
    private var providerAdded = false
    private var running = false
    private var wakeLock: PowerManager.WakeLock? = null

    private val PROVIDER_NAME = LocationManager.GPS_PROVIDER

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        engine = MovementEngine(START_LAT, START_LON)
        handler = Handler(Looper.getMainLooper())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> start()
            ACTION_STOP -> {
                stop()
                stopSelf()
            }
        }
        return START_NOT_STICKY
    }

    private fun start() {
        if (running) return
        running = true

        startForeground(NOTIF_ID, buildNotification())
        acquireWakeLock()
        setupMockProvider()
        showOverlay()
        handler.post(updateLoop)
    }

    private fun stop() {
        if (!running) return
        running = false

        handler.removeCallbacksAndMessages(null)
        hideOverlay()
        teardownMockProvider()
        releaseWakeLock()
        if (Build.VERSION.SDK_INT >= 33) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    override fun onDestroy() {
        stop()
        super.onDestroy()
    }

    // --- Mock provider ---

    private fun setupMockProvider() {
        try {
            locationManager.addTestProvider(
                PROVIDER_NAME,
                false,  // requiresNetwork
                false,  // requiresSatellite
                false,  // requiresCell
                false,  // hasMonetaryCost
                true,   // supportsAltitude
                true,   // supportsSpeed
                true,   // supportsBearing
                android.location.Criteria.POWER_LOW,
                android.location.Criteria.ACCURACY_FINE
            )
            locationManager.setTestProviderEnabled(PROVIDER_NAME, true)
            providerAdded = true
        } catch (e: SecurityException) {
            // User nao configurou "App de localizacao simulada"
            // Nao da pra fazer nada, segue sem mock
            providerAdded = false
        } catch (e: IllegalArgumentException) {
            // Provider ja existe
            try {
                locationManager.setTestProviderEnabled(PROVIDER_NAME, true)
                providerAdded = true
            } catch (ignored: Exception) {}
        }
    }

    private fun teardownMockProvider() {
        if (!providerAdded) return
        try {
            locationManager.setTestProviderEnabled(PROVIDER_NAME, false)
            locationManager.removeTestProvider(PROVIDER_NAME)
        } catch (ignored: Exception) {}
        providerAdded = false
    }

    private fun publishMockLocation() {
        if (!providerAdded) return
        val snap = engine.snapshot()
        try {
            val loc = Location(PROVIDER_NAME).apply {
                latitude = snap.lat
                longitude = snap.lon
                altitude = 0.0
                accuracy = 5f
                time = System.currentTimeMillis()
                elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
                speed = snap.speedMps
                bearing = snap.heading
                if (Build.VERSION.SDK_INT >= 26) {
                    bearingAccuracyDegrees = 5f
                    speedAccuracyMetersPerSecond = 1f
                    verticalAccuracyMeters = 10f
                }
            }
            locationManager.setTestProviderLocation(PROVIDER_NAME, loc)
        } catch (ignored: Exception) {}
    }

    // --- Loop de update ---

    private var lastUpdateMs: Long = 0

    private val updateLoop = object : Runnable {
        override fun run() {
            if (!running) return
            val now = SystemClock.elapsedRealtime()
            val dt = if (lastUpdateMs == 0L) 0f else ((now - lastUpdateMs) / 1000f).coerceAtMost(0.1f)
            lastUpdateMs = now

            engine.update(dt, currentInput)
            publishMockLocation()

            handler.postDelayed(this, UPDATE_INTERVAL_MS)
        }
    }

    // --- Overlay ---

    @Volatile private var currentInput: MovementEngine.Input =
        MovementEngine.Input(0f, 0f, 0f, 0f)

    private fun showOverlay() {
        if (overlayRoot != null) return

        val root = LayoutInflater.from(this).inflate(R.layout.overlay_joystick, null) as FrameLayout
        val joystick = root.findViewById<JoystickOverlayView>(R.id.joystick)
        val btnClose = root.findViewById<View>(R.id.btn_close)

        joystick.onInputChange = { input ->
            currentInput = MovementEngine.Input(input.x, input.y, input.magnitude, input.heading)
        }
        btnClose.setOnClickListener {
            stop()
            stopSelf()
        }

        val overlayType = if (Build.VERSION.SDK_INT >= 26) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            overlayType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.END
            x = 40
            y = 100
        }
        root.background = ColorDrawable(0x00000000)
        windowManager.addView(root, params)
        overlayRoot = root
    }

    private fun hideOverlay() {
        overlayRoot?.let {
            try { windowManager.removeView(it) } catch (ignored: Exception) {}
        }
        overlayRoot = null
    }

    // --- Notification + WakeLock ---

    private fun buildNotification(): Notification {
        val channelId = NOTIF_CHANNEL
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(
                channelId,
                "Fake GPS",
                NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Mock location + joystick ativos" }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }

        val openIntent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val openPending = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(this, FakeGPSService::class.java).setAction(ACTION_STOP)
        val stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("Fake GPS ativo")
            .setContentText("Minimize e abra o Chrome em gocollect.fun")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(openPending)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Parar", stopPending)
            .build()
    }

    private fun acquireWakeLock() {
        if (wakeLock != null) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FakeGPS::WakeLock").apply {
            setReferenceCounted(false)
            acquire(60 * 60 * 1000L)  // 1h cap, re-adquire se precisar
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }
}
