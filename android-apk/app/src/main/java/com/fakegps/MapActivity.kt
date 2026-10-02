package com.fakegps

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Mapa Leaflet dentro do app. Dois modos:
 *   - TP: clique teleporta imediatamente
 *   - Andar sozinho: clique busca rota OSRM e inicia autopilot no FakeGPSService
 *
 * Comunicacao JS <-> Kotlin via addJavascriptInterface (Android.*)
 * e evaluateJavascript("window.FakeGPS.*").
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
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun currentLatLon(): Pair<Double, Double> {
        val prefs = getSharedPreferences(FakeGPSService.PREFS_NAME, Context.MODE_PRIVATE)
        val lat = java.lang.Double.longBitsToDouble(
            prefs.getLong(FakeGPSService.KEY_LAT, java.lang.Double.doubleToRawLongBits(FakeGPSService.DEFAULT_LAT))
        )
        val lon = java.lang.Double.longBitsToDouble(
            prefs.getLong(FakeGPSService.KEY_LON, java.lang.Double.doubleToRawLongBits(FakeGPSService.DEFAULT_LON))
        )
        return Pair(lat, lon)
    }

    inner class Bridge {
        @JavascriptInterface
        fun getInitialLatLon(): String {
            val (lat, lon) = currentLatLon()
            return JSONObject().put("lat", lat).put("lon", lon).toString()
        }

        @JavascriptInterface
        fun teleport(lat: Double, lon: Double) {
            // Salva na prefs e manda intent pro service (se estiver rodando)
            getSharedPreferences(FakeGPSService.PREFS_NAME, Context.MODE_PRIVATE).edit()
                .putLong(FakeGPSService.KEY_LAT, java.lang.Double.doubleToRawLongBits(lat))
                .putLong(FakeGPSService.KEY_LON, java.lang.Double.doubleToRawLongBits(lon))
                .apply()
            val intent = Intent(this@MapActivity, FakeGPSService::class.java)
                .setAction(FakeGPSService.ACTION_TELEPORT)
                .putExtra(FakeGPSService.EXTRA_LAT, lat)
                .putExtra(FakeGPSService.EXTRA_LON, lon)
            startService(intent)
            main.post {
                webView.evaluateJavascript("window.FakeGPS.onTeleported($lat, $lon)", null)
            }
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

                    val intent = Intent(this@MapActivity, FakeGPSService::class.java)
                        .setAction(FakeGPSService.ACTION_SET_ROUTE)
                        .putExtra(FakeGPSService.EXTRA_WAYPOINTS, waypointsJson)
                    startService(intent)

                    main.post {
                        val escaped = waypointsJson.replace("\\", "\\\\").replace("'", "\\'")
                        webView.evaluateJavascript(
                            "window.FakeGPS.onRouteReady('$escaped', $distance)", null
                        )
                    }
                } catch (e: Exception) {
                    main.post {
                        val msg = (e.message ?: "falha").replace("'", " ")
                        webView.evaluateJavascript("window.FakeGPS.onRouteError('$msg')", null)
                    }
                }
            }
        }

        @JavascriptInterface
        fun stopRoute() {
            val intent = Intent(this@MapActivity, FakeGPSService::class.java)
                .setAction(FakeGPSService.ACTION_STOP_ROUTE)
            startService(intent)
        }
    }
}
