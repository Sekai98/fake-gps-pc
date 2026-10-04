package com.stepinjector

import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Autopilot: segue array de waypoints com cadência natural.
 * Portado do FakeGPS APK.
 */
class AutoPilot {

    companion object {
        const val WAYPOINT_REACHED_METERS = 3f
        const val APPROACH_SLOWDOWN_METERS = 15f

        fun distanceMeters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
            val R = 6371000.0
            val toRad = PI / 180
            val dLat = (lat2 - lat1) * toRad
            val dLon = (lon2 - lon1) * toRad
            val a = sin(dLat / 2).let { it * it } +
                cos(lat1 * toRad) * cos(lat2 * toRad) * sin(dLon / 2).let { it * it }
            return 2 * R * asin(sqrt(a))
        }

        fun computeHeading(fromLat: Double, fromLon: Double, toLat: Double, toLon: Double): Float {
            val latRad = fromLat * PI / 180
            val dLat = toLat - fromLat
            val dLon = toLon - fromLon
            val dNorth = dLat * 111320
            val dEast = dLon * 111320 * cos(latRad)
            val h = atan2(dEast, dNorth) * 180 / PI
            return ((h + 360) % 360).toFloat()
        }
    }

    data class Waypoint(val lat: Double, val lon: Double)

    @Volatile private var active = false
    private var waypoints: List<Waypoint> = emptyList()
    @Volatile private var currentIdx = 0

    fun start(points: List<Waypoint>): Boolean {
        if (points.size < 2) return false
        waypoints = points
        currentIdx = 1
        active = true
        return true
    }

    fun stop(): Boolean {
        val wasActive = active
        active = false
        waypoints = emptyList()
        currentIdx = 0
        return wasActive
    }

    fun isActive(): Boolean = active && currentIdx < waypoints.size

    fun computeInput(currentLat: Double, currentLon: Double): MovementEngine.Input? {
        if (!isActive()) return null

        val target = waypoints[currentIdx]
        val dist = distanceMeters(currentLat, currentLon, target.lat, target.lon)

        if (dist < WAYPOINT_REACHED_METERS) {
            currentIdx++
            if (currentIdx >= waypoints.size) {
                stop()
                return null
            }
        }

        val next = waypoints[currentIdx]
        val heading = computeHeading(currentLat, currentLon, next.lat, next.lon)
        val headingRad = heading * PI / 180
        var magnitude = 1f

        val isLast = currentIdx == waypoints.size - 1
        if (isLast && dist < APPROACH_SLOWDOWN_METERS) {
            val t = (dist / APPROACH_SLOWDOWN_METERS).toFloat()
            magnitude *= max(0.25f, t)
        }

        return MovementEngine.Input(
            x = sin(headingRad).toFloat(),
            y = cos(headingRad).toFloat(),
            magnitude = magnitude,
            heading = heading
        )
    }

    fun remainingMeters(currentLat: Double, currentLon: Double): Double {
        if (!isActive()) return 0.0
        val first = waypoints.getOrNull(currentIdx) ?: return 0.0
        var total = distanceMeters(currentLat, currentLon, first.lat, first.lon)
        for (i in currentIdx until waypoints.size - 1) {
            val a = waypoints[i]
            val b = waypoints[i + 1]
            total += distanceMeters(a.lat, a.lon, b.lat, b.lon)
        }
        return total
    }
}
