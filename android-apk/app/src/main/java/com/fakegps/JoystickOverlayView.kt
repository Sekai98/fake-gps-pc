package com.fakegps

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.min

/**
 * Joystick visual.
 *
 * Fundo circular + knob interno. Usuario arrasta o knob.
 * Reporta input (x, y, magnitude, heading) via callback.
 *
 * x normalizado: -1 (esquerda) a +1 (direita) - mapeado como leste positivo
 * y normalizado: -1 (base) a +1 (topo) - mapeado como norte positivo
 * magnitude: 0 (centro) a 1 (borda)
 * heading: 0=Norte, 90=Leste (CW, convencao GPS)
 */
class JoystickOverlayView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : View(context, attrs) {

    data class InputData(val x: Float, val y: Float, val magnitude: Float, val heading: Float)

    var onInputChange: ((InputData) -> Unit)? = null

    private val bgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(140, 20, 30, 50)
        style = Paint.Style.FILL
    }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(200, 66, 133, 244)  // azul
        style = Paint.Style.STROKE
        strokeWidth = 4f
    }
    private val knobPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.argb(230, 66, 133, 244)
        style = Paint.Style.FILL
    }
    private val knobBorderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        style = Paint.Style.STROKE
        strokeWidth = 3f
    }

    private var knobX = 0f
    private var knobY = 0f
    private var centerX = 0f
    private var centerY = 0f
    private var outerR = 0f
    private var knobR = 0f

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        centerX = w / 2f
        centerY = h / 2f
        outerR = min(w, h) / 2f - 10f
        knobR = outerR * 0.4f
        knobX = centerX
        knobY = centerY
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawCircle(centerX, centerY, outerR, bgPaint)
        canvas.drawCircle(centerX, centerY, outerR, borderPaint)
        canvas.drawCircle(knobX, knobY, knobR, knobPaint)
        canvas.drawCircle(knobX, knobY, knobR, knobBorderPaint)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.action) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_MOVE -> {
                val dx = event.x - centerX
                val dy = event.y - centerY
                val dist = hypot(dx.toDouble(), dy.toDouble()).toFloat()
                val maxReach = outerR - knobR
                if (dist > maxReach) {
                    val ratio = maxReach / dist
                    knobX = centerX + dx * ratio
                    knobY = centerY + dy * ratio
                } else {
                    knobX = event.x
                    knobY = event.y
                }
                emitInput()
                invalidate()
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                knobX = centerX
                knobY = centerY
                emitInput()
                invalidate()
            }
        }
        return true
    }

    private fun emitInput() {
        val dx = knobX - centerX
        val dy = knobY - centerY
        val maxReach = outerR - knobR
        val mag = (hypot(dx.toDouble(), dy.toDouble()).toFloat() / maxReach).coerceIn(0f, 1f)

        // x+ = leste, y+ = norte (inverter dy porque na tela Y cresce pra baixo)
        val nx = (dx / maxReach).coerceIn(-1f, 1f)
        val ny = (-dy / maxReach).coerceIn(-1f, 1f)

        // heading cartografico: 0=Norte, 90=Leste (CW)
        val headingRad = atan2(nx.toDouble(), ny.toDouble())
        var headingDeg = Math.toDegrees(headingRad).toFloat()
        if (headingDeg < 0) headingDeg += 360f

        onInputChange?.invoke(InputData(nx, ny, mag, headingDeg))
    }
}
