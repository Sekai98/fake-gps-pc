package com.stepinjector.xposed

import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import de.robv.android.xposed.IXposedHookLoadPackage
import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import de.robv.android.xposed.XposedHelpers
import de.robv.android.xposed.callbacks.XC_LoadPackage.LoadPackageParam
import java.lang.reflect.Constructor
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Hook do SensorManager pra apps-alvo (Mooney, WeWard, etc).
 *
 * Objetivo: fingir que TYPE_STEP_COUNTER existe no device e alimentar
 * listeners com valores incrementais vindos do nosso Step Tracker.
 *
 * v0.4.1 (esqueleto): valor hardcoded = incrementa 1 passo/segundo.
 * Próximas versões: ler de ContentProvider do Step Tracker.
 */
class PedometerHook : IXposedHookLoadPackage {

    companion object {
        // Apps que recebem o hook. Pode expandir pra WeWard, Sweatcoin, etc.
        private val TARGET_PACKAGES = setOf(
            "gg.mooney.app",
            // "com.sweatco.app",       // Sweatcoin — TODO v0.4.5
            // "fit.sloth.weward",      // WeWard — TODO v0.4.5
        )

        private const val TAG = "PedometerHook"

        // Valores "fake" injetados
        @Volatile var cumulativeSteps: Long = 0
        private var startRealtime: Long = 0

        private val listeners = CopyOnWriteArrayList<RegisteredListener>()
        private val mainHandler = Handler(Looper.getMainLooper())
    }

    data class RegisteredListener(
        val listener: SensorEventListener,
        val sensor: Sensor,
        val sensorManager: SensorManager
    )

    override fun handleLoadPackage(lpparam: LoadPackageParam) {
        if (lpparam.packageName !in TARGET_PACKAGES) return
        XposedBridge.log("[$TAG] loading in ${lpparam.packageName}")

        // Reset do session no primeiro load dentro do app alvo
        startRealtime = SystemClock.elapsedRealtime()
        cumulativeSteps = 0

        hookGetDefaultSensor(lpparam)
        hookGetSensorList(lpparam)
        hookRegisterListener(lpparam)
        startStepLoop()
    }

    /**
     * Hook SensorManager.getDefaultSensor(int type).
     * Se app pede TYPE_STEP_COUNTER (19) ou TYPE_STEP_DETECTOR (18) e sistema não tem,
     * fabricamos um Sensor fake e retornamos.
     */
    private fun hookGetDefaultSensor(lpparam: LoadPackageParam) {
        XposedHelpers.findAndHookMethod(
            SensorManager::class.java, "getDefaultSensor",
            Int::class.javaPrimitiveType,
            object : XC_MethodHook() {
                override fun afterHookedMethod(param: MethodHookParam) {
                    val type = param.args[0] as Int
                    if (type != Sensor.TYPE_STEP_COUNTER && type != Sensor.TYPE_STEP_DETECTOR) return
                    if (param.result != null) return  // sistema já forneceu
                    val fake = createFakeSensor(type)
                    if (fake != null) {
                        param.result = fake
                        XposedBridge.log("[$TAG] getDefaultSensor($type) → fake sensor")
                    }
                }
            }
        )
    }

    private fun hookGetSensorList(lpparam: LoadPackageParam) {
        XposedHelpers.findAndHookMethod(
            SensorManager::class.java, "getSensorList",
            Int::class.javaPrimitiveType,
            object : XC_MethodHook() {
                override fun afterHookedMethod(param: MethodHookParam) {
                    val type = param.args[0] as Int
                    @Suppress("UNCHECKED_CAST")
                    val original = (param.result as? List<Sensor>) ?: emptyList()
                    if (type == Sensor.TYPE_STEP_COUNTER || type == Sensor.TYPE_ALL) {
                        if (original.none { it.type == Sensor.TYPE_STEP_COUNTER }) {
                            val fake = createFakeSensor(Sensor.TYPE_STEP_COUNTER)
                            if (fake != null) {
                                param.result = original + fake
                                XposedBridge.log("[$TAG] getSensorList($type) → +fake step_counter")
                            }
                        }
                    }
                }
            }
        )
    }

    /**
     * Hook em registerListener: guardamos o listener pra chamar manualmente depois.
     * Importante retornar true pro app achar que registrou.
     */
    private fun hookRegisterListener(lpparam: LoadPackageParam) {
        XposedHelpers.findAndHookMethod(
            SensorManager::class.java, "registerListener",
            SensorEventListener::class.java, Sensor::class.java,
            Int::class.javaPrimitiveType,
            object : XC_MethodHook() {
                override fun afterHookedMethod(param: MethodHookParam) {
                    val l = param.args[0] as? SensorEventListener ?: return
                    val s = param.args[1] as? Sensor ?: return
                    if (s.type != Sensor.TYPE_STEP_COUNTER && s.type != Sensor.TYPE_STEP_DETECTOR) return
                    val sm = param.thisObject as SensorManager
                    listeners.add(RegisteredListener(l, s, sm))
                    param.result = true
                    XposedBridge.log("[$TAG] registerListener captured (type=${s.type}, total=${listeners.size})")
                }
            }
        )

        // Overload com Handler
        XposedHelpers.findAndHookMethod(
            SensorManager::class.java, "registerListener",
            SensorEventListener::class.java, Sensor::class.java,
            Int::class.javaPrimitiveType, Handler::class.java,
            object : XC_MethodHook() {
                override fun afterHookedMethod(param: MethodHookParam) {
                    val l = param.args[0] as? SensorEventListener ?: return
                    val s = param.args[1] as? Sensor ?: return
                    if (s.type != Sensor.TYPE_STEP_COUNTER && s.type != Sensor.TYPE_STEP_DETECTOR) return
                    val sm = param.thisObject as SensorManager
                    listeners.add(RegisteredListener(l, s, sm))
                    param.result = true
                    XposedBridge.log("[$TAG] registerListener(handler) captured (type=${s.type}, total=${listeners.size})")
                }
            }
        )

        XposedHelpers.findAndHookMethod(
            SensorManager::class.java, "unregisterListener",
            SensorEventListener::class.java,
            object : XC_MethodHook() {
                override fun afterHookedMethod(param: MethodHookParam) {
                    val l = param.args[0] as? SensorEventListener ?: return
                    listeners.removeIf { it.listener == l }
                    XposedBridge.log("[$TAG] unregisterListener (remaining=${listeners.size})")
                }
            }
        )
    }

    /**
     * Loop que a cada 1s incrementa cumulativeSteps e dispara SensorEvent pros listeners.
     * v0.4.1: hardcoded +1 passo/s. Próximas versões: ler de ContentProvider do Step Tracker.
     */
    private fun startStepLoop() {
        val runnable = object : Runnable {
            override fun run() {
                cumulativeSteps += 1  // TODO v0.4.2: substituir por valor real do Step Tracker
                fireStepEvent()
                mainHandler.postDelayed(this, 1000)
            }
        }
        mainHandler.postDelayed(runnable, 1000)
    }

    private fun fireStepEvent() {
        val currentListeners = listeners.toList()
        for (reg in currentListeners) {
            try {
                val event = createSensorEvent(reg.sensor, cumulativeSteps.toFloat())
                reg.listener.onSensorChanged(event)
            } catch (e: Throwable) {
                XposedBridge.log("[$TAG] fire error: ${e.message}")
            }
        }
    }

    /**
     * SensorEvent tem construtor privado. Reflection pra criar.
     * Campos: sensor, accuracy, timestamp, values[].
     */
    private fun createSensorEvent(sensor: Sensor, stepCount: Float): SensorEvent {
        // SensorEvent(int valueSize) construtor com 1 arg
        val ctor: Constructor<SensorEvent> = SensorEvent::class.java
            .getDeclaredConstructor(Int::class.javaPrimitiveType)
        ctor.isAccessible = true
        val event = ctor.newInstance(1)
        // Preencher campos via reflection (são public)
        XposedHelpers.setObjectField(event, "sensor", sensor)
        XposedHelpers.setIntField(event, "accuracy", SensorManager.SENSOR_STATUS_ACCURACY_HIGH)
        XposedHelpers.setLongField(event, "timestamp", SystemClock.elapsedRealtimeNanos())
        event.values[0] = stepCount
        return event
    }

    /**
     * Sensor tem construtor hidden. Via reflection cria um "virtual" step counter.
     */
    private fun createFakeSensor(type: Int): Sensor? {
        return try {
            val ctor = Sensor::class.java.getDeclaredConstructor()
            ctor.isAccessible = true
            val sensor = ctor.newInstance()
            XposedHelpers.setObjectField(sensor, "mName", "Virtual Step Counter")
            XposedHelpers.setObjectField(sensor, "mVendor", "StepInjector")
            XposedHelpers.setIntField(sensor, "mVersion", 1)
            XposedHelpers.setIntField(sensor, "mHandle", -1)
            XposedHelpers.setIntField(sensor, "mType", type)
            XposedHelpers.setFloatField(sensor, "mMaxRange", 1e9f)
            XposedHelpers.setFloatField(sensor, "mResolution", 1f)
            XposedHelpers.setFloatField(sensor, "mPower", 0.1f)
            XposedHelpers.setIntField(sensor, "mMinDelay", 0)
            try { XposedHelpers.setObjectField(sensor, "mStringType", "android.sensor.step_counter") } catch (ignored: Throwable) {}
            sensor
        } catch (e: Throwable) {
            XposedBridge.log("[$TAG] createFakeSensor failed: ${e.message}")
            null
        }
    }
}
