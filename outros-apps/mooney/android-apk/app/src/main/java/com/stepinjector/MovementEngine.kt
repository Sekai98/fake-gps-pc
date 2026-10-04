package com.stepinjector

/**
 * Motor de movimento: integra input de direção em deslocamento lat/lon.
 * Portado do FakeGPS APK (android-apk/.../MovementEngine.kt).
 *
 * Pra Step Tracker, o input geralmente vem do AutoPilot (segue waypoints).
 * O serviço converte o deslocamento acumulado em passos pro Health Connect.
 */
class MovementEngine(startLat: Double, startLon: Double) {

    data class Position(
        val lat: Double,
        val lon: Double,
        val heading: Float,
        val speedMps: Float
    )

    data class Input(
        val x: Float,
        val y: Float,
        val magnitude: Float,
        val heading: Float
    )

    @Volatile var lat: Double = startLat
    @Volatile var lon: Double = startLon
    @Volatile var heading: Float = 0f
    @Volatile var speedMps: Float = 0f

    fun setPosition(newLat: Double, newLon: Double) {
        lat = newLat
        lon = newLon
    }

    @Volatile var maxSpeedKmh: Float = 5f

    private val accelTime: Float get() = 0.3f + maxSpeedKmh / 15f

    fun update(dt: Float, input: Input) {
        val maxMps = maxSpeedKmh / 3.6f
        val targetMps = maxMps * input.magnitude

        val accel = maxMps / accelTime
        val diff = targetMps - speedMps
        val change = Math.signum(diff) * minOf(Math.abs(diff), accel * dt)
        speedMps = (speedMps + change).coerceAtLeast(0f)
        if (speedMps < 0.001f) speedMps = 0f

        if (input.magnitude > 0.05f) {
            heading = input.heading
        }

        if (speedMps > 0) {
            val distMeters = speedMps * dt
            val headingRad = Math.toRadians(heading.toDouble())
            val dNorth = distMeters * Math.cos(headingRad)
            val dEast = distMeters * Math.sin(headingRad)

            val latRad = Math.toRadians(lat)
            lat += dNorth / 111320.0
            lon += dEast / (111320.0 * Math.cos(latRad))
        }
    }

    fun teleport(newLat: Double, newLon: Double) {
        lat = newLat
        lon = newLon
        speedMps = 0f
    }

    fun snapshot(): Position = Position(lat, lon, heading, speedMps)
}
