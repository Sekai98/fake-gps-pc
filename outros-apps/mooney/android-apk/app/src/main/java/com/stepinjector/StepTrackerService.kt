package com.stepinjector

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.records.StepsRecord
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.Executors

/**
 * Foreground service que:
 *  - Mantém MovementEngine + AutoPilot ativos a 10Hz
 *  - Converte deslocamento acumulado em passos
 *  - Injeta StepsRecord no Health Connect a cada FLUSH_INTERVAL_MS
 *
 * Fluxo:
 *  ACTION_START → inicializa com lat/lon
 *  ACTION_SET_ROUTE + waypoints → inicia autopilot
 *  ACTION_TELEPORT + lat/lon → move marker instantâneo (sem gerar passos)
 *  ACTION_PAUSE → pausa autopilot (mantém service ativo)
 *  ACTION_RESUME → retoma autopilot
 *  ACTION_STOP → para tudo
 */
class StepTrackerService : Service() {

    companion object {
        const val ACTION_START = "com.stepinjector.ACTION_START"
        const val ACTION_SET_ROUTE = "com.stepinjector.ACTION_SET_ROUTE"
        const val ACTION_TELEPORT = "com.stepinjector.ACTION_TELEPORT"
        const val ACTION_PAUSE = "com.stepinjector.ACTION_PAUSE"
        const val ACTION_RESUME = "com.stepinjector.ACTION_RESUME"
        const val ACTION_STOP = "com.stepinjector.ACTION_STOP"
        const val ACTION_SET_SPEED = "com.stepinjector.ACTION_SET_SPEED"

        const val EXTRA_LAT = "lat"
        const val EXTRA_LON = "lon"
        const val EXTRA_WAYPOINTS = "waypoints"      // JSON array [[lat,lon],...]
        const val EXTRA_SPEED_KMH = "speed_kmh"

        const val NOTIF_CHANNEL = "step_tracker"
        const val NOTIF_ID = 101

        const val UPDATE_INTERVAL_MS = 100L     // 10Hz, igual FakeGPS
        const val FLUSH_INTERVAL_MS = 30_000L   // injeta Health Connect a cada 30s
        const val PERSIST_INTERVAL_MS = 500L    // SharedPreferences lat/lon a cada 500ms (mapa polla 1s)
        const val METERS_PER_STEP = 0.70        // 70cm por passo (adulto médio)

        // Keys das SharedPreferences
        const val PREFS_NAME = "step_tracker"
        const val KEY_LAT = "last_lat"
        const val KEY_LON = "last_lon"
        const val KEY_SPEED_KMH = "speed_kmh"
        const val KEY_TODAY_STEPS = "today_steps_injected"
        const val KEY_TODAY_DATE = "today_date_iso"
    }

    private lateinit var handler: Handler
    private lateinit var engine: MovementEngine
    private val autopilot = AutoPilot()
    private var healthConnectClient: HealthConnectClient? = null
    private var wakeLock: PowerManager.WakeLock? = null

    private var running = false
    private var paused = false
    private var lastUpdateMs: Long = 0
    private var lastFlushMs: Long = 0
    private var lastPersistMs: Long = 0
    private var accumulatedMeters: Double = 0.0
    private var sessionStartMs: Long = 0

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        handler = Handler(Looper.getMainLooper())
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val lat = java.lang.Double.longBitsToDouble(
            prefs.getLong(KEY_LAT, java.lang.Double.doubleToRawLongBits(-23.561684))
        )
        val lon = java.lang.Double.longBitsToDouble(
            prefs.getLong(KEY_LON, java.lang.Double.doubleToRawLongBits(-46.655981))
        )
        engine = MovementEngine(lat, lon)
        engine.maxSpeedKmh = prefs.getFloat(KEY_SPEED_KMH, 5f)

        if (HealthConnectClient.getSdkStatus(this) == HealthConnectClient.SDK_AVAILABLE) {
            healthConnectClient = HealthConnectClient.getOrCreate(this)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> start(
                intent.getDoubleExtra(EXTRA_LAT, engine.lat),
                intent.getDoubleExtra(EXTRA_LON, engine.lon)
            )
            ACTION_SET_ROUTE -> handleSetRoute(intent)
            ACTION_TELEPORT -> handleTeleport(intent)
            ACTION_PAUSE -> handlePause()
            ACTION_RESUME -> handleResume()
            ACTION_SET_SPEED -> handleSetSpeed(intent)
            ACTION_STOP -> { stop(); stopSelf() }
        }
        return START_NOT_STICKY
    }

    private fun start(lat: Double, lon: Double) {
        if (running) return
        running = true
        paused = false
        engine.setPosition(lat, lon)
        persistPosition()

        startForeground(NOTIF_ID, buildNotification())
        acquireWakeLock()
        lastUpdateMs = 0
        lastFlushMs = System.currentTimeMillis()
        lastPersistMs = lastFlushMs
        sessionStartMs = lastFlushMs
        accumulatedMeters = 0.0
        handler.post(updateLoop)
    }

    private fun stop() {
        if (!running) return
        running = false
        handler.removeCallbacksAndMessages(null)
        // Flush final: injeta o que tiver acumulado
        flushSteps(force = true)
        persistPosition()
        releaseWakeLock()
        if (Build.VERSION.SDK_INT >= 33) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }

    override fun onDestroy() {
        stop()
        super.onDestroy()
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
                paused = false
                refreshNotification()
            }
        } catch (ignored: Exception) {}
    }

    private fun handleTeleport(intent: Intent) {
        if (!running) return
        val lat = intent.getDoubleExtra(EXTRA_LAT, Double.NaN)
        val lon = intent.getDoubleExtra(EXTRA_LON, Double.NaN)
        if (lat.isNaN() || lon.isNaN()) return
        autopilot.stop()
        // IMPORTANTE: teleport NÃO gera passos. Primeiro flusha o que tem, depois pula.
        flushSteps(force = true)
        engine.teleport(lat, lon)
        accumulatedMeters = 0.0  // zera, não ganha passos pelo pulo
        persistPosition()
        refreshNotification()
    }

    private fun handlePause() {
        if (!running) return
        paused = true
        refreshNotification()
    }

    private fun handleResume() {
        if (!running) return
        paused = false
        refreshNotification()
    }

    private fun handleSetSpeed(intent: Intent) {
        val kmh = intent.getFloatExtra(EXTRA_SPEED_KMH, 5f)
        engine.maxSpeedKmh = kmh.coerceIn(1f, 50f)
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putFloat(KEY_SPEED_KMH, engine.maxSpeedKmh)
            .apply()
        refreshNotification()
    }

    // --- Loop ---

    private val updateLoop = object : Runnable {
        override fun run() {
            if (!running) return
            val now = SystemClock.elapsedRealtime()
            val dt = if (lastUpdateMs == 0L) 0f else ((now - lastUpdateMs) / 1000f).coerceAtMost(0.1f)
            lastUpdateMs = now

            if (!paused) {
                val input = if (autopilot.isActive()) {
                    autopilot.computeInput(engine.lat, engine.lon)
                        ?: MovementEngine.Input(0f, 0f, 0f, 0f)
                } else {
                    MovementEngine.Input(0f, 0f, 0f, 0f)
                }

                engine.update(dt, input)

                // Acumula distância percorrida nesse tick
                if (engine.speedMps > 0) {
                    accumulatedMeters += engine.speedMps * dt
                }

                // Autopilot terminou nessa iteração?
                if (!autopilot.isActive() && accumulatedMeters > 0) {
                    // Deixa o flush normal pegar
                }
            }

            // Persiste posição a cada 500ms pro mapa WebView ler via SharedPreferences
            val wallNow = System.currentTimeMillis()
            if (wallNow - lastPersistMs >= PERSIST_INTERVAL_MS) {
                persistPosition()
                lastPersistMs = wallNow
            }

            // Flush periódico pro Health Connect
            if (wallNow - lastFlushMs >= FLUSH_INTERVAL_MS) {
                flushSteps(force = false)
            }

            handler.postDelayed(this, UPDATE_INTERVAL_MS)
        }
    }

    /**
     * Converte accumulatedMeters em passos e injeta no Health Connect.
     * Zera accumulatedMeters e atualiza lastFlushMs.
     */
    private fun flushSteps(force: Boolean) {
        if (!force && accumulatedMeters < METERS_PER_STEP * 5) return // menos de 5 passos = segura
        val steps = (accumulatedMeters / METERS_PER_STEP).toLong()
        if (steps <= 0) {
            lastFlushMs = System.currentTimeMillis()
            return
        }

        val startMs = lastFlushMs
        val endMs = System.currentTimeMillis()
        if (endMs <= startMs) {
            lastFlushMs = endMs
            return
        }

        val client = healthConnectClient
        if (client == null) {
            // Health Connect indisponível: só zera o acumulado pra não acumular pra sempre
            accumulatedMeters = 0.0
            lastFlushMs = endMs
            return
        }

        // Snapshot pra uso dentro da coroutine
        val stepsToInject = steps
        val startInstant = Instant.ofEpochMilli(startMs)
        val endInstant = Instant.ofEpochMilli(endMs)
        val offset = ZoneId.systemDefault().rules.getOffset(endInstant)

        serviceScope.launch {
            try {
                client.insertRecords(listOf(
                    StepsRecord(
                        count = stepsToInject,
                        startTime = startInstant,
                        startZoneOffset = offset,
                        endTime = endInstant,
                        endZoneOffset = offset
                    )
                ))
                // Atualiza contador local
                incrementTodayCounter(stepsToInject)
            } catch (e: Exception) {
                // Log mas não quebra o loop
                android.util.Log.w("StepTracker", "insertRecords failed: ${e.message}")
            }
        }

        accumulatedMeters = 0.0
        lastFlushMs = endMs
        refreshNotification()
    }

    // --- Persistência ---

    private fun persistPosition() {
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putLong(KEY_LAT, java.lang.Double.doubleToRawLongBits(engine.lat))
            .putLong(KEY_LON, java.lang.Double.doubleToRawLongBits(engine.lon))
            .apply()
    }

    private fun incrementTodayCounter(steps: Long) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val today = java.time.LocalDate.now().toString()
        val savedDate = prefs.getString(KEY_TODAY_DATE, "") ?: ""
        val current = if (savedDate == today) prefs.getLong(KEY_TODAY_STEPS, 0L) else 0L
        prefs.edit()
            .putString(KEY_TODAY_DATE, today)
            .putLong(KEY_TODAY_STEPS, current + steps)
            .apply()
    }

    // --- Notification ---

    private fun buildNotification(): Notification {
        ensureChannel()
        val stopIntent = Intent(this, StepTrackerService::class.java).setAction(ACTION_STOP)
        val stopPending = PendingIntent.getService(
            this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val openIntent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val openPending = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title: String
        val text: String
        if (paused) {
            title = "Step Tracker pausado"
            text = "Toque Resume no app pra retomar"
        } else if (autopilot.isActive()) {
            val remaining = autopilot.remainingMeters(engine.lat, engine.lon)
            title = "Andando (${engine.maxSpeedKmh.toInt()} km/h)"
            text = if (remaining >= 1000)
                String.format("%.2f km restantes", remaining / 1000)
            else
                "${remaining.toInt()} m restantes"
        } else {
            title = "Step Tracker ativo"
            text = "Nenhuma rota ativa — abra o app pra escolher destino"
        }

        return NotificationCompat.Builder(this, NOTIF_CHANNEL)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(android.R.drawable.ic_menu_directions)
            .setContentIntent(openPending)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Parar", stopPending)
            .build()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(
                NOTIF_CHANNEL,
                "Step Tracker",
                NotificationManager.IMPORTANCE_LOW
            ).apply { description = "Autopilot + injeção de passos" }
            (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
                .createNotificationChannel(channel)
        }
    }

    private fun refreshNotification() {
        val notif = buildNotification()
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .notify(NOTIF_ID, notif)
    }

    private fun acquireWakeLock() {
        if (wakeLock != null) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "StepTracker::WakeLock").apply {
            setReferenceCounted(false)
            acquire(60 * 60 * 1000L)
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
    }
}
