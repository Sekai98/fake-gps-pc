package com.stepinjector.xposed

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

class InfoActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 96, 48, 48)
        }
        val title = TextView(this).apply {
            text = "Pedometer Hook v0.4.1"
            textSize = 24f
        }
        val body = TextView(this).apply {
            text = """
                Módulo LSPosed. Ative no LSPosed Manager → Modules → Pedometer Hook.

                Target: gg.mooney.app

                v0.4.1: injeta +1 passo/segundo (teste isolado).
                v0.4.2: lerá do Step Tracker via ContentProvider.

                Logs: LSPosed Manager → Logs
            """.trimIndent()
            textSize = 14f
            setPadding(0, 32, 0, 0)
        }
        root.addView(title)
        root.addView(body)
        root.gravity = Gravity.TOP or Gravity.START
        setContentView(root)
    }
}
