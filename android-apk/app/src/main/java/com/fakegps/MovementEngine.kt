package com.fakegps

/**
 * Motor de movimento: integra input do joystick em deslocamento lat/lon.
 * Porta simplificada de src/renderer/movement.js (Electron).
 *
 * Modelo: input {x, y, magnitude, heading} vira velocidade (m/s), que vira delta lat/lon.
 */
class MovementEngine(startLat: Double, startLon: Double) {

    data class Position(
        val lat: Double,
        val lon: Double,
        val heading: Float,   // graus, 0 = Norte, 90 = Leste (CW)
        val speedMps: Float
    )

    data class Input(
        val x: Float,         // -1 a 1 (lateral: leste positivo)
        val y: Float,         // -1 a 1 (vertical: norte positivo)
        val magnitude: Float, // 0 a 1
        val heading: Float    // graus
    )

    @Volatile var lat: Double = startLat
    @Volatile var lon: Double = startLon
    @Volatile var heading: Float = 0f
    @Volatile var speedMps: Float = 0f

    fun setPosition(newLat: Double, newLon: Double) {
        lat = newLat
        lon = newLon
    }

    // Config
    @Volatile var maxSpeedKmh: Float = 5f  // walking default

    private val accelTime: Float get() = 0.3f + maxSpeedKmh / 15f  // mesma formula do Electron

    /**
     * Atualiza posicao com base no input e tempo decorrido.
     * dt em segundos.
     */
    fun update(dt: Float, input: Input) {
        val maxMps = maxSpeedKmh / 3.6f
        val targetMps = maxMps * input.magnitude

        // Rampa de aceleracao/desaceleracao
        val accel = maxMps / accelTime  // m/s^2
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
