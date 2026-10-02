package com.fakegps

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Launcher: tela inicial que verifica permissoes e inicia/para o foreground service.
 *
 * Dois modos de operacao:
 *   - Standalone: joystick + mapa + autopilot internos (sem PC)
 *   - Slave: controlado pelo Fake GPS Electron no PC via HTTP (campo URL + Tab)
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
    private lateinit var btnMap: Button

    private lateinit var inputSlaveUrl: EditText
    private lateinit var inputSlaveTab: EditText
    private lateinit var slaveStatus: TextView
    private lateinit var btnSlaveTest: Button
    private lateinit var btnSlaveStart: Button

    private val PERM_REQUEST_LOCATION = 1001
    private val PERM_REQUEST_NOTIF = 1002

    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

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
        btnMap = findViewById(R.id.btn_map)

        inputSlaveUrl = findViewById(R.id.input_slave_url)
        inputSlaveTab = findViewById(R.id.input_slave_tab)
        slaveStatus = findViewById(R.id.slave_status)
        btnSlaveTest = findViewById(R.id.btn_slave_test)
        btnSlaveStart = findViewById(R.id.btn_slave_start)

        // Carrega ultimo URL/tab usado
        val prefs = getSharedPreferences(FakeGPSService.PREFS_NAME, Context.MODE_PRIVATE)
        inputSlaveUrl.setText(prefs.getString(FakeGPSService.KEY_SLAVE_URL, "") ?: "")
        inputSlaveTab.setText(prefs.getString(FakeGPSService.KEY_SLAVE_TAB, "") ?: "")

        btnOverlay.setOnClickListener { requestOverlayPermission() }
        btnLocation.setOnClickListener { requestLocationPermission() }
        btnNotif.setOnClickListener { requestNotifPermission() }
        btnDevOptions.setOnClickListener { openDevOptions() }
        btnStart.setOnClickListener { startFakeGPS() }
        btnStop.setOnClickListener { stopFakeGPS() }
        btnMap.setOnClickListener { startActivity(Intent(this, MapActivity::class.java)) }
        btnSlaveTest.setOnClickListener { testSlaveConnection() }
        btnSlaveStart.setOnClickListener { startSlave() }
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
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

        val allPerms = overlay && location && notif
        btnStart.isEnabled = allPerms
        btnSlaveStart.isEnabled = allPerms
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

    private fun normalizeUrl(raw: String): String? {
        val trimmed = raw.trim().trimEnd('/')
        if (trimmed.isEmpty()) return null
        return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed
        else "http://$trimmed"
    }

    private fun testSlaveConnection() {
        val url = normalizeUrl(inputSlaveUrl.text.toString())
        if (url == null) {
            slaveStatus.text = "URL vazia"
            slaveStatus.setTextColor(0xFFE53935.toInt())
            return
        }
        slaveStatus.text = "Testando..."
        slaveStatus.setTextColor(0xFF9AA0A6.toInt())
        executor.execute {
            try {
                val conn = (URL("$url/health").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 3000
                    readTimeout = 3000
                    requestMethod = "GET"
                }
                val code = conn.responseCode
                val body = if (code == 200) conn.inputStream.bufferedReader().readText() else ""
                conn.disconnect()
                main.post {
                    if (code == 200) {
                        slaveStatus.text = "✓ Conectou (${body.take(80)})"
                        slaveStatus.setTextColor(0xFF4CAF50.toInt())
                    } else {
                        slaveStatus.text = "✗ HTTP $code"
                        slaveStatus.setTextColor(0xFFE53935.toInt())
                    }
                }
            } catch (e: Exception) {
                main.post {
                    slaveStatus.text = "✗ ${e.message}"
                    slaveStatus.setTextColor(0xFFE53935.toInt())
                }
            }
        }
    }

    private fun startSlave() {
        val url = normalizeUrl(inputSlaveUrl.text.toString())
        if (url == null) {
            Toast.makeText(this, "Preencha a URL do Electron", Toast.LENGTH_SHORT).show()
            return
        }
        val tab = inputSlaveTab.text.toString().trim()
        // Salva nas prefs
        getSharedPreferences(FakeGPSService.PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(FakeGPSService.KEY_SLAVE_URL, url)
            .putString(FakeGPSService.KEY_SLAVE_TAB, tab)
            .apply()

        val intent = Intent(this, FakeGPSService::class.java)
            .setAction(FakeGPSService.ACTION_START_SLAVE)
            .putExtra(FakeGPSService.EXTRA_SLAVE_URL, url)
            .putExtra(FakeGPSService.EXTRA_SLAVE_TAB, tab)
        if (Build.VERSION.SDK_INT >= 26) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        Toast.makeText(this, "Modo slave iniciado - PC controla", Toast.LENGTH_LONG).show()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        updateStatus()
    }
}
