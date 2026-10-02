package com.fakegps

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.ceil
import kotlin.math.max

/**
 * Routing OSRM foot. Porta de src/renderer/routing.js (Electron).
 *
 * Usa routing.openstreetmap.de/routed-foot (perfil pedestre real).
 * Chamadas de rede sao sincronas - CHAME EM BACKGROUND THREAD.
 */
object Routing {

    private const val OSRM_BASE = "https://routing.openstreetmap.de/routed-foot/route/v1/driving"

    data class Route(
        val waypoints: List<AutoPilot.Waypoint>,
        val distanceMeters: Double,
        val durationSeconds: Double
    )

    /**
     * Busca rota a pe de A -> B.
     * @throws Exception em caso de falha HTTP ou OSRM
     */
    @Throws(Exception::class)
    fun fetchFootRoute(fromLat: Double, fromLon: Double, toLat: Double, toLon: Double): Route {
        val url = "$OSRM_BASE/$fromLon,$fromLat;$toLon,$toLat?overview=full&geometries=geojson&steps=false"
        val body = httpGet(url)
        val data = JSONObject(body)
        val code = data.optString("code")
        if (code != "Ok") {
            throw RuntimeException("OSRM: " + data.optString("message", "rota nao encontrada"))
        }
        val routes = data.optJSONArray("routes") ?: throw RuntimeException("sem rotas")
        if (routes.length() == 0) throw RuntimeException("sem rotas")

        val route = routes.getJSONObject(0)
        val geometry = route.optJSONObject("geometry") ?: throw RuntimeException("sem geometry")
        val coords = geometry.optJSONArray("coordinates") ?: throw RuntimeException("sem coordinates")
        if (coords.length() < 2) throw RuntimeException("rota com dados invalidos")

        val raw = ArrayList<AutoPilot.Waypoint>(coords.length())
        for (i in 0 until coords.length()) {
            val pair = coords.getJSONArray(i)
            raw.add(AutoPilot.Waypoint(pair.getDouble(1), pair.getDouble(0)))
        }

        // Prefix: liga ponto real de origem ao primeiro waypoint OSRM (se longe)
        val first = raw.first()
        val prefixDist = AutoPilot.distanceMeters(fromLat, fromLon, first.lat, first.lon)
        var waypoints: MutableList<AutoPilot.Waypoint> = raw
        if (prefixDist > 2) {
            val prefix = interpolateStraight(fromLat, fromLon, first.lat, first.lon, 5.0)
            val combined = ArrayList<AutoPilot.Waypoint>(prefix.size + raw.size)
            combined.addAll(prefix.dropLast(1))
            combined.addAll(raw)
            waypoints = combined
        }

        // Sufix: liga ultimo waypoint OSRM ao ponto exato clicado
        val last = waypoints.last()
        val suffixDist = AutoPilot.distanceMeters(last.lat, last.lon, toLat, toLon)
        if (suffixDist > 2) {
            val suffix = interpolateStraight(last.lat, last.lon, toLat, toLon, 5.0)
            waypoints.addAll(suffix)
        }

        val distance = route.optDouble("distance", 0.0) + prefixDist + suffixDist
        val duration = route.optDouble("duration", 0.0)
        return Route(waypoints, distance, duration)
    }

    private fun interpolateStraight(
        fromLat: Double, fromLon: Double,
        toLat: Double, toLon: Double,
        stepMeters: Double
    ): List<AutoPilot.Waypoint> {
        val d = AutoPilot.distanceMeters(fromLat, fromLon, toLat, toLon)
        if (d < 1) return listOf(AutoPilot.Waypoint(toLat, toLon))
        val steps = max(1, ceil(d / stepMeters).toInt())
        val out = ArrayList<AutoPilot.Waypoint>(steps)
        for (i in 1..steps) {
            val t = i.toDouble() / steps
            out.add(AutoPilot.Waypoint(
                fromLat + (toLat - fromLat) * t,
                fromLon + (toLon - fromLon) * t
            ))
        }
        return out
    }

    private fun httpGet(urlStr: String): String {
        val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "FakeGPS-Android/0.2")
            connectTimeout = 10000
            readTimeout = 15000
        }
        try {
            val code = conn.responseCode
            if (code != 200) throw RuntimeException("HTTP $code")
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }
}
