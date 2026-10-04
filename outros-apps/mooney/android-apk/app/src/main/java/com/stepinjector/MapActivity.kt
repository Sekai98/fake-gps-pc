package com.stepinjector

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * WebView host com Leaflet. Automação via JS <-> Kotlin bridge "Android".
 *
 * Chamadas que o JS faz pra cá:
 *  - getInitialLatLon() → { lat, lon }
 *  - startRoute(lat, lon) → busca OSRM + ACTION_SET_ROUTE no service
 *  - teleport(lat, lon) → ACTION_TELEPORT (não gera passos)
 *  - setSpeed(kmh) → ACTION_SET_SPEED
 *  - pause() / resume() → ACTION_PAUSE / RESUME
 *  - stop() → ACTION_STOP
 *  - getCurrentPosition() → lê prefs
 */
class MapActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_map)
        webView = findViewById(R.id.webview_map)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowContentAccess = true
        webView.addJavascriptInterface(Bridge(), "Android")
        webView.loadUrl("file:///android_asset/map.html")

        // Garante que o service está rodando
        ensureServiceStarted()
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun currentLatLon(): Pair<Double, Double> {
        val prefs = getSharedPreferences(StepTrackerService.PREFS_NAME, Context.MODE_PRIVATE)
        val lat = java.lang.Double.longBitsToDouble(
            prefs.getLong(StepTrackerService.KEY_LAT, java.lang.Double.doubleToRawLongBits(-23.561684))
        )
        val lon = java.lang.Double.longBitsToDouble(
            prefs.getLong(StepTrackerService.KEY_LON, java.lang.Double.doubleToRawLongBits(-46.655981))
        )
        return Pair(lat, lon)
    }

    private fun ensureServiceStarted() {
        val (lat, lon) = currentLatLon()
        val intent = Intent(this, StepTrackerService::class.java)
            .setAction(StepTrackerService.ACTION_START)
            .putExtra(StepTrackerService.EXTRA_LAT, lat)
            .putExtra(StepTrackerService.EXTRA_LON, lon)
        if (Build.VERSION.SDK_INT >= 26) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    inner class Bridge {
        @JavascriptInterface
        fun getInitialLatLon(): String {
            val (lat, lon) = currentLatLon()
            return JSONObject().put("lat", lat).put("lon", lon).toString()
        }

        @JavascriptInterface
        fun getCurrentPosition(): String {
            val (lat, lon) = currentLatLon()
            return JSONObject().put("lat", lat).put("lon", lon).toString()
        }

        @JavascriptInterface
        fun teleport(lat: Double, lon: Double) {
            val intent = Intent(this@MapActivity, StepTrackerService::class.java)
                .setAction(StepTrackerService.ACTION_TELEPORT)
                .putExtra(StepTrackerService.EXTRA_LAT, lat)
                .putExtra(StepTrackerService.EXTRA_LON, lon)
            startService(intent)
            main.post {
                webView.evaluateJavascript("window.StepTracker.onTeleported($lat, $lon)", null)
            }
        }

        @JavascriptInterface
        fun setSpeed(kmh: Double) {
            val intent = Intent(this@MapActivity, StepTrackerService::class.java)
                .setAction(StepTrackerService.ACTION_SET_SPEED)
                .putExtra(StepTrackerService.EXTRA_SPEED_KMH, kmh.toFloat())
            startService(intent)
        }

        @JavascriptInterface
        fun pause() {
            startService(Intent(this@MapActivity, StepTrackerService::class.java)
                .setAction(StepTrackerService.ACTION_PAUSE))
        }

        @JavascriptInterface
        fun resume() {
            startService(Intent(this@MapActivity, StepTrackerService::class.java)
                .setAction(StepTrackerService.ACTION_RESUME))
        }

        @JavascriptInterface
        fun stop() {
            startService(Intent(this@MapActivity, StepTrackerService::class.java)
                .setAction(StepTrackerService.ACTION_STOP))
        }

        @JavascriptInterface
        fun startRoute(toLat: Double, toLon: Double) {
            val (fromLat, fromLon) = currentLatLon()
            executor.execute {
                try {
                    val route = Routing.fetchFootRoute(fromLat, fromLon, toLat, toLon)
                    val arr = JSONArray()
                    route.waypoints.forEach { wp ->
                        arr.put(JSONObject().put("lat", wp.lat).put("lon", wp.lon))
                    }
                    val waypointsJson = arr.toString()
                    val distance = route.distanceMeters

                    val intent = Intent(this@MapActivity, StepTrackerService::class.java)
                        .setAction(StepTrackerService.ACTION_SET_ROUTE)
                        .putExtra(StepTrackerService.EXTRA_WAYPOINTS, waypointsJson)
                    startService(intent)

                    main.post {
                        val escaped = waypointsJson.replace("\\", "\\\\").replace("'", "\\'")
                        webView.evaluateJavascript(
                            "window.StepTracker.onRouteReady('$escaped', $distance)", null
                        )
                    }
                } catch (e: Exception) {
                    main.post {
                        val msg = (e.message ?: "falha").replace("'", " ")
                        webView.evaluateJavascript("window.StepTracker.onRouteError('$msg')", null)
                    }
                }
            }
        }
    }
}
