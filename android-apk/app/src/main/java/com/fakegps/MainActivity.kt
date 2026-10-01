package com.fakegps

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * Launcher: tela inicial que verifica permissoes e inicia/para o foreground service.
 *
 * Fluxo:
 *   1. User abre o app
 *   2. Checa 3 permissoes:
 *      - ACCESS_FINE_LOCATION (runtime)
 *      - POST_NOTIFICATIONS (runtime, Android 13+)
 *      - SYSTEM_ALERT_WINDOW (manual via settings)
 *      - "App de localizacao simulada" (manual via dev options)
 *   3. User clica "Iniciar" -> inicia FakeGPSService
 *   4. User minimiza, abre Chrome, acessa gocollect.fun
 *   5. Site pega localizacao falsa, joystick flutuante move
 */
class MainActivity : AppCompatActivity() {

    private lateinit var statusOverlay: TextView
    private lateinit var statusMock: TextView
    private lateinit var statusLocation: TextView
    private lateinit var btnOverlay: Button
    private lateinit var btnLocation: Button
    private lateinit var btnNotif: Button
    private lateinit var btnDevOptions: Button
    private lateinit var btnStart: Button
    private lateinit var btnStop: Button

    private val PERM_REQUEST_LOCATION = 1001
    private val PERM_REQUEST_NOTIF = 1002

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusOverlay = findViewById(R.id.status_overlay)
        statusMock = findViewById(R.id.status_mock)
        statusLocation = findViewById(R.id.status_location)
        btnOverlay = findViewById(R.id.btn_overlay)
        btnLocation = findViewById(R.id.btn_location)
        btnNotif = findViewById(R.id.btn_notif)
        btnDevOptions = findViewById(R.id.btn_dev_options)
        btnStart = findViewById(R.id.btn_start)
        btnStop = findViewById(R.id.btn_stop)

        btnOverlay.setOnClickListener { requestOverlayPermission() }
        btnLocation.setOnClickListener { requestLocationPermission() }
        btnNotif.setOnClickListener { requestNotifPermission() }
        btnDevOptions.setOnClickListener { openDevOptions() }
        btnStart.setOnClickListener { startFakeGPS() }
        btnStop.setOnClickListener { stopFakeGPS() }
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
    }

    private fun hasLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    private fun hasNotifPermission(): Boolean =
        if (Build.VERSION.SDK_INT >= 33) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        } else true

    private fun hasOverlayPermission(): Boolean = Settings.canDrawOverlays(this)

    private fun updateStatus() {
        val overlay = hasOverlayPermission()
        val notif = hasNotifPermission()
        val location = hasLocationPermission()

        statusOverlay.text = if (overlay) "✓ Pode desenhar sobre outros apps" else "✗ Falta: desenhar sobre outros apps"
        statusLocation.text = if (location) "✓ Localizacao autorizada" else "✗ Falta: autorizar localizacao"
        statusMock.text = "ℹ Ative este app como \"App de localizacao simulada\" nas Opcoes do Desenvolvedor"

        btnOverlay.isEnabled = !overlay
        btnLocation.isEnabled = !location
        btnNotif.isEnabled = !notif
        btnNotif.visibility = if (Build.VERSION.SDK_INT >= 33 && !notif) android.view.View.VISIBLE else android.view.View.GONE

        btnStart.isEnabled = overlay && location && notif
    }

    private fun requestOverlayPermission() {
        val intent = Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:$packageName")
        )
        startActivity(intent)
    }

    private fun requestLocationPermission() {
        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
            PERM_REQUEST_LOCATION
        )
    }

    private fun requestNotifPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                PERM_REQUEST_NOTIF
            )
        }
    }

    private fun openDevOptions() {
        try {
            startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS))
        } catch (e: Exception) {
            Toast.makeText(
                this,
                "Nao foi possivel abrir Opcoes do Desenvolvedor. Ative manualmente: Config -> Sobre -> toque 7x em Numero da versao",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    private fun startFakeGPS() {
        val intent = Intent(this, FakeGPSService::class.java)
            .setAction(FakeGPSService.ACTION_START)
        if (Build.VERSION.SDK_INT >= 26) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        Toast.makeText(this, "Fake GPS iniciado - minimize e abra o Chrome", Toast.LENGTH_LONG).show()
    }

    private fun stopFakeGPS() {
        val intent = Intent(this, FakeGPSService::class.java)
            .setAction(FakeGPSService.ACTION_STOP)
        startService(intent)
        Toast.makeText(this, "Fake GPS parado", Toast.LENGTH_SHORT).show()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        updateStatus()
    }
}
