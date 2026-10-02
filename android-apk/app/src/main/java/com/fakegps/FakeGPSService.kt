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
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
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
        const val ACTION_SET_ROUTE = "com.fakegps.ACTION_SET_ROUTE"
        const val ACTION_STOP_ROUTE = "com.fakegps.ACTION_STOP_ROUTE"
        const val ACTION_TELEPORT = "com.fakegps.ACTION_TELEPORT"
        const val ACTION_SHOW_OVERLAY = "com.fakegps.ACTION_SHOW_OVERLAY"

        const val EXTRA_WAYPOINTS = "waypoints"
        const val EXTRA_LAT = "lat"
        const val EXTRA_LON = "lon"

        const val NOTIF_CHANNEL = "fake_gps_channel"
        const val NOTIF_ID = 42
        const val UPDATE_INTERVAL_MS = 50L  // 20Hz - mais suave que o Electron, Chrome Android aprecia
        const val PERSIST_INTERVAL_MS = 1000L  // salva lat/lon no prefs a cada 1s (serve pro mapa ler posicao fresca)
        const val NOTIF_REFRESH_MS = 1000L  // atualiza notif a cada 1s durante rota

        const val PREFS_NAME = "fakegps"
        const val KEY_LAT = "last_lat"
        const val KEY_LON = "last_lon"
        const val KEY_OVERLAY_X = "overlay_x"
        const val KEY_OVERLAY_Y = "overlay_y"

        // Fallback inicial se nunca houve save: Av. Paulista
        const val DEFAULT_LAT = -23.561684
        const val DEFAULT_LON = -46.655981
    }

    private lateinit var windowManager: WindowManager
    private lateinit var locationManager: LocationManager
    private lateinit var engine: MovementEngine
    private val autopilot = AutoPilot()
    private lateinit var handler: Handler
    private var overlayRoot: View? = null
    private var providerAdded = false
    private var running = false
    private var wakeLock: PowerManager.WakeLock? = null
    private var lastNotifText: String? = null

    // Mock multi-provider: Chrome/Fused as vezes prefere NETWORK. Setamos ambos.
    private val PROVIDERS = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
    private val activeProviders = mutableListOf<String>()
    private var speedLabel: TextView? = null
    private var presetWalk: TextView? = null
    private var presetRun: TextView? = null
    private var presetCar: TextView? = null

    data class Preset(val name: String, val kmh: Float, val view: () -> TextView?)
    private val presets by lazy {
        listOf(
            Preset("walk", 5f) { presetWalk },
            Preset("run", 12f) { presetRun },
            Preset("car", 50f) { presetCar }
        )
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val lat = java.lang.Double.longBitsToDouble(
            prefs.getLong(KEY_LAT, java.lang.Double.doubleToRawLongBits(DEFAULT_LAT))
        )
        val lon = java.lang.Double.longBitsToDouble(
            prefs.getLong(KEY_LON, java.lang.Double.doubleToRawLongBits(DEFAULT_LON))
        )
        engine = MovementEngine(lat, lon)
        handler = Handler(Looper.getMainLooper())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> start()
            ACTION_STOP -> {
                stop()
                stopSelf()
            }
            ACTION_SET_ROUTE -> handleSetRoute(intent)
            ACTION_STOP_ROUTE -> handleStopRoute()
            ACTION_TELEPORT -> handleTeleport(intent)
            ACTION_SHOW_OVERLAY -> {
                if (running) showOverlay()
            }
        }
        return START_NOT_STICKY
    }

    private fun handleSetRoute(intent: Intent) {
        if (!running) return
        val json = intent.getStringExtra(EXTRA_WAYPOINTS) ?: return
        try {
            val arr = org.json.JSONArray(json)
            val points = ArrayList<AutoPilot.Waypoint>(arr.length())
            for (i in 0 until arr.length()) {
                val o = arr.getJSONObject(i)
                points.add(AutoPilot.Waypoint(o.getDouble("lat"), o.getDouble("lon")))
            }
            if (autopilot.start(points)) {
                refreshNotification()
            }
        } catch (ignored: Exception) {}
    }

    private fun handleStopRoute() {
        if (autopilot.stop()) {
            currentInput = MovementEngine.Input(0f, 0f, 0f, 0f)
            refreshNotification()
        }
    }

    private fun handleTeleport(intent: Intent) {
        if (!running) return
        val lat = intent.getDoubleExtra(EXTRA_LAT, Double.NaN)
        val lon = intent.getDoubleExtra(EXTRA_LON, Double.NaN)
        if (lat.isNaN() || lon.isNaN()) return
        autopilot.stop()
        engine.teleport(lat, lon)
        currentInput = MovementEngine.Input(0f, 0f, 0f, 0f)
        persistPosition()
        refreshNotification()
    }

    private fun start() {
        if (running) return
        running = true

        startForeground(NOTIF_ID, buildNotification())
        acquireWakeLock()
        setupMockProvider()
        showOverlay()
        handler.post(updateLoop)
        handler.postDelayed(persistLoop, PERSIST_INTERVAL_MS)
        handler.postDelayed(notifLoop, NOTIF_REFRESH_MS)
    }

    private fun stop() {
        if (!running) return
        running = false

        handler.removeCallbacksAndMessages(null)
        persistPosition()
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

    private fun persistPosition() {
        val snap = engine.snapshot()
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putLong(KEY_LAT, java.lang.Double.doubleToRawLongBits(snap.lat))
            .putLong(KEY_LON, java.lang.Double.doubleToRawLongBits(snap.lon))
            .apply()
    }

    private val persistLoop = object : Runnable {
        override fun run() {
            if (!running) return
            persistPosition()
            handler.postDelayed(this, PERSIST_INTERVAL_MS)
        }
    }

    override fun onDestroy() {
        stop()
        super.onDestroy()
    }

    // --- Mock provider ---

    private fun setupMockProvider() {
        activeProviders.clear()
        PROVIDERS.forEach { provider ->
            try {
                locationManager.addTestProvider(
                    provider,
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
                locationManager.setTestProviderEnabled(provider, true)
                activeProviders.add(provider)
            } catch (e: SecurityException) {
                // User nao configurou "App de localizacao simulada"
            } catch (e: IllegalArgumentException) {
                // Provider ja existe
                try {
                    locationManager.setTestProviderEnabled(provider, true)
                    activeProviders.add(provider)
                } catch (ignored: Exception) {}
            }
        }
        providerAdded = activeProviders.isNotEmpty()
    }

    private fun teardownMockProvider() {
        if (!providerAdded) return
        activeProviders.forEach { provider ->
            try {
                locationManager.setTestProviderEnabled(provider, false)
                locationManager.removeTestProvider(provider)
            } catch (ignored: Exception) {}
        }
        activeProviders.clear()
        providerAdded = false
    }

    private fun publishMockLocation() {
        if (!providerAdded) return
        val snap = engine.snapshot()
        val now = System.currentTimeMillis()
        val elapsed = SystemClock.elapsedRealtimeNanos()
        activeProviders.forEach { provider ->
            try {
                val loc = Location(provider).apply {
                    latitude = snap.lat
                    longitude = snap.lon
                    altitude = 0.0
                    accuracy = 2f  // GPS fino: 2m. Antes era 5m
                    time = now
                    elapsedRealtimeNanos = elapsed
                    speed = snap.speedMps
                    bearing = snap.heading
                    if (Build.VERSION.SDK_INT >= 26) {
                        bearingAccuracyDegrees = 1f  // 1 grau
                        speedAccuracyMetersPerSecond = 0.5f
                        verticalAccuracyMeters = 3f
                    }
                }
                locationManager.setTestProviderLocation(provider, loc)
            } catch (ignored: Exception) {}
        }
    }

    // --- Loop de update ---

    private var lastUpdateMs: Long = 0

    private val updateLoop = object : Runnable {
        override fun run() {
            if (!running) return
            val now = SystemClock.elapsedRealtime()
            val dt = if (lastUpdateMs == 0L) 0f else ((now - lastUpdateMs) / 1000f).coerceAtMost(0.1f)
            lastUpdateMs = now

            // Autopilot tem prioridade sobre o joystick
            val input = if (autopilot.isActive()) {
                autopilot.computeInput(engine.lat, engine.lon) ?: MovementEngine.Input(0f, 0f, 0f, 0f)
            } else {
                currentInput
            }

            engine.update(dt, input)
            publishMockLocation()
            updateSpeedLabel()

            // Se autopilot terminou nesse tick, limpa notif
            if (!autopilot.isActive() && lastNotifText != null) {
                refreshNotification()
            }

            handler.postDelayed(this, UPDATE_INTERVAL_MS)
        }
    }

    private val notifLoop = object : Runnable {
        override fun run() {
            if (!running) return
            if (autopilot.isActive()) refreshNotification()
            handler.postDelayed(this, NOTIF_REFRESH_MS)
        }
    }

    private fun updateSpeedLabel() {
        speedLabel?.let { label ->
            val kmh = engine.speedMps * 3.6f
            label.text = String.format("%.1f km/h", kmh)
            // Cor progressiva: verde < 60%, amarelo 60-90%, vermelho 90%+
            val ratio = (kmh / engine.maxSpeedKmh).coerceIn(0f, 1.5f)
            label.setTextColor(
                when {
                    ratio >= 0.9f -> 0xFFE53935.toInt()  // vermelho
                    ratio >= 0.6f -> 0xFFFFD600.toInt()  // amarelo
                    else -> 0xFF4CAF50.toInt()           // verde
                }
            )
        }
    }

    // --- Overlay ---

    @Volatile private var currentInput: MovementEngine.Input =
        MovementEngine.Input(0f, 0f, 0f, 0f)

    private var overlayParams: WindowManager.LayoutParams? = null

    private fun showOverlay() {
        if (overlayRoot != null) return

        val root = LayoutInflater.from(this).inflate(R.layout.overlay_joystick, null) as LinearLayout
        val joystick = root.findViewById<JoystickOverlayView>(R.id.joystick)
        val btnClose = root.findViewById<View>(R.id.btn_close)
        val dragHandle = root.findViewById<View>(R.id.drag_handle)
        speedLabel = root.findViewById(R.id.speed_label)
        presetWalk = root.findViewById(R.id.preset_walk)
        presetRun = root.findViewById(R.id.preset_run)
        presetCar = root.findViewById(R.id.preset_car)

        joystick.onInputChange = { input ->
            currentInput = MovementEngine.Input(input.x, input.y, input.magnitude, input.heading)
        }
        btnClose.setOnClickListener {
            // Esconde overlay mas mantem servico. Reabrir via notif "Joystick".
            hideOverlay()
        }

        // Carrega ultimo preset + posicao do overlay (SharedPreferences)
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val savedPreset = prefs.getString("preset", "walk") ?: "walk"
        applyPreset(savedPreset)

        presets.forEach { p ->
            p.view()?.setOnClickListener {
                applyPreset(p.name)
                prefs.edit().putString("preset", p.name).apply()
            }
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
            gravity = Gravity.TOP or Gravity.START
            x = prefs.getInt(KEY_OVERLAY_X, 40)
            y = prefs.getInt(KEY_OVERLAY_Y, 100)
        }
        windowManager.addView(root, params)
        overlayRoot = root
        overlayParams = params

        attachToggleDrag(dragHandle, joystick, root, params)
    }

    private var dragModeActive = false

    private fun attachToggleDrag(
        handle: View,
        joystick: JoystickOverlayView,
        root: View,
        params: WindowManager.LayoutParams
    ) {
        var initialX = 0
        var initialY = 0
        var touchStartX = 0f
        var touchStartY = 0f

        val dragListener = View.OnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = params.x
                    initialY = params.y
                    touchStartX = event.rawX
                    touchStartY = event.rawY
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    params.x = initialX + (event.rawX - touchStartX).toInt()
                    params.y = initialY + (event.rawY - touchStartY).toInt()
                    try { windowManager.updateViewLayout(root, params) } catch (ignored: Exception) {}
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                        .putInt(KEY_OVERLAY_X, params.x)
                        .putInt(KEY_OVERLAY_Y, params.y)
                        .apply()
                    true
                }
                else -> false
            }
        }

        fun applyDragModeVisual() {
            if (dragModeActive) {
                handle.setBackgroundColor(0xFFF9AB00.toInt())  // amarelo = modo mover
                joystick.alpha = 0.3f
                joystick.setOnTouchListener { _, _ -> true }  // bloqueia joystick
                root.setOnTouchListener(dragListener)
            } else {
                handle.setBackgroundColor(0xFF333A44.toInt())  // cinza = normal
                joystick.alpha = 1.0f
                joystick.setOnTouchListener(null)
                root.setOnTouchListener(null)
            }
        }

        // Sempre comeca OFF ao abrir overlay (evita joystick travado)
        dragModeActive = false
        applyDragModeVisual()

        handle.setOnClickListener {
            dragModeActive = !dragModeActive
            applyDragModeVisual()
        }
    }

    private fun applyPreset(name: String) {
        val preset = presets.find { it.name == name } ?: presets[0]
        engine.maxSpeedKmh = preset.kmh
        // Visual: destaca o botao ativo (azul), outros ficam cinza
        presets.forEach { p ->
            p.view()?.setBackgroundColor(if (p.name == name) 0xFF4285F4.toInt() else 0xFF333A44.toInt())
        }
    }

    private fun hideOverlay() {
        overlayRoot?.let {
            try { windowManager.removeView(it) } catch (ignored: Exception) {}
        }
        overlayRoot = null
        overlayParams = null
        speedLabel = null
        presetWalk = null
        presetRun = null
        presetCar = null
    }

    // --- Notification + WakeLock ---

    private fun buildNotification(): Notification {
        ensureChannel()

        val openIntent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val openPending = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stopPending = pendingService(1, ACTION_STOP)
        val showOverlayPending = pendingService(2, ACTION_SHOW_OVERLAY)

        val title: String
        val text: String
        val builder = NotificationCompat.Builder(this, NOTIF_CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(openPending)
            .setOngoing(true)

        if (autopilot.isActive()) {
            val remaining = autopilot.remainingMeters(engine.lat, engine.lon)
            val remainingKm = remaining / 1000.0
            title = "Em rota"
            text = if (remainingKm >= 1.0)
                String.format("%.2f km restantes - %.1f km/h", remainingKm, engine.speedMps * 3.6f)
            else
                String.format("%d m restantes - %.1f km/h", remaining.toInt(), engine.speedMps * 3.6f)
            val stopRoutePending = pendingService(3, ACTION_STOP_ROUTE)
            builder
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Parar rota", stopRoutePending)
                .addAction(android.R.drawable.ic_menu_mylocation, "Joystick", showOverlayPending)
                .addAction(android.R.drawable.ic_lock_power_off, "Parar app", stopPending)
        } else {
            title = "Fake GPS ativo"
            text = "Toque pra abrir o app"
            builder
                .addAction(android.R.drawable.ic_menu_mylocation, "Joystick", showOverlayPending)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Parar", stopPending)
        }

        lastNotifText = text
        return builder.setContentTitle(title).setContentText(text).build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(
                NOTIF_CHANNEL,
                "Fake GPS",
                NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Mock location + joystick ativos" }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
    }

    private fun pendingService(reqCode: Int, action: String): PendingIntent {
        val intent = Intent(this, FakeGPSService::class.java).setAction(action)
        return PendingIntent.getService(
            this, reqCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun refreshNotification() {
        val notif = buildNotification()
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIF_ID, notif)
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
