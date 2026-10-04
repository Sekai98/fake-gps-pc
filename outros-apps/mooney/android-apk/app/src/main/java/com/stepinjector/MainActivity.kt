package com.stepinjector

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.google.android.gms.location.LocationServices
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * Tela inicial: checa permissões + mostra status + botão pra abrir o mapa.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var statusLocation: TextView
    private lateinit var statusHealth: TextView
    private lateinit var statusNotif: TextView
    private lateinit var statusMock: TextView
    private lateinit var btnPermLocation: Button
    private lateinit var btnPermHealth: Button
    private lateinit var btnPermNotif: Button
    private lateinit var btnOpenDev: Button
    private lateinit var btnOpenMap: Button
    private lateinit var btnStop: Button
    private lateinit var todayLabel: TextView

    private val PERM_LOCATION_CODE = 1001
    private val PERM_NOTIF_CODE = 1002

    private val healthPermissions = setOf(
        HealthPermission.getWritePermission(StepsRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class)
    )

    private val requestHealthPerms = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { refreshStatus() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusLocation = findViewById(R.id.status_location)
        statusHealth = findViewById(R.id.status_health)
        statusNotif = findViewById(R.id.status_notif)
        statusMock = findViewById(R.id.status_mock)
        btnPermLocation = findViewById(R.id.btn_perm_location)
        btnPermHealth = findViewById(R.id.btn_perm_health)
        btnPermNotif = findViewById(R.id.btn_perm_notif)
        btnOpenDev = findViewById(R.id.btn_open_dev)
        btnOpenMap = findViewById(R.id.btn_open_map)
        btnStop = findViewById(R.id.btn_stop)
        todayLabel = findViewById(R.id.today_label)

        btnPermLocation.setOnClickListener { requestLocationPerm() }
        btnPermHealth.setOnClickListener { requestHealthPerms.launch(healthPermissions) }
        btnPermNotif.setOnClickListener { requestNotifPerm() }
        btnOpenDev.setOnClickListener { openDevSettings() }
        btnOpenMap.setOnClickListener { openMap() }
        btnStop.setOnClickListener { stopService() }
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun hasLocation(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED

    private fun hasNotif(): Boolean =
        if (Build.VERSION.SDK_INT >= 33)
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        else true

    /**
     * Tenta registrar + remover um test provider pra ver se o user configurou
     * "App de localização simulada" nas Opções de Desenvolvedor.
     * Retorna true se conseguiu (= app é o mock location autorizado).
     */
    private fun hasMockLocationPermission(): Boolean {
        return try {
            val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            lm.addTestProvider(
                LocationManager.GPS_PROVIDER,
                false, false, false, false, true, true, true,
                android.location.Criteria.POWER_LOW,
                android.location.Criteria.ACCURACY_FINE
            )
            lm.removeTestProvider(LocationManager.GPS_PROVIDER)
            true
        } catch (e: SecurityException) {
            false
        } catch (e: IllegalArgumentException) {
            // Provider já estava registrado = outro app ou nosso service rodando
            true
        } catch (e: Exception) {
            false
        }
    }

    private fun refreshStatus() {
        val loc = hasLocation()
        val notif = hasNotif()
        val mock = hasMockLocationPermission()

        statusLocation.text = if (loc) "✓ Localização" else "✗ Falta localização"
        btnPermLocation.visibility = if (loc) android.view.View.GONE else android.view.View.VISIBLE

        statusNotif.text = if (notif) "✓ Notificações" else "✗ Falta notificações"
        btnPermNotif.visibility = if (notif || Build.VERSION.SDK_INT < 33)
            android.view.View.GONE else android.view.View.VISIBLE

        statusMock.text = if (mock) "✓ Mock GPS configurado" else "✗ Falta: Opções de Dev → App de localização simulada = Step Tracker"
        btnOpenDev.visibility = if (mock) android.view.View.GONE else android.view.View.VISIBLE

        // Health Connect
        val sdkStatus = HealthConnectClient.getSdkStatus(this)
        if (sdkStatus != HealthConnectClient.SDK_AVAILABLE) {
            statusHealth.text = "✗ Health Connect não instalado"
            btnPermHealth.visibility = android.view.View.GONE
            btnOpenMap.isEnabled = false
        } else {
            val client = HealthConnectClient.getOrCreate(this)
            CoroutineScope(Dispatchers.Main).launch {
                try {
                    val granted = client.permissionController.getGrantedPermissions()
                    val ok = granted.containsAll(healthPermissions)
                    statusHealth.text = if (ok) "✓ Health Connect" else "✗ Falta Health Connect"
                    btnPermHealth.visibility = if (ok) android.view.View.GONE else android.view.View.VISIBLE
                    btnOpenMap.isEnabled = loc && notif && ok && mock
                } catch (e: Exception) {
                    statusHealth.text = "✗ Health Connect: ${e.message}"
                }
            }
            // Carrega total do dia
            CoroutineScope(Dispatchers.Main).launch {
                try {
                    val now = ZonedDateTime.now()
                    val startOfDay = now.toLocalDate().atStartOfDay(ZoneId.systemDefault())
                    val response = client.readRecords(
                        ReadRecordsRequest(
                            recordType = StepsRecord::class,
                            timeRangeFilter = TimeRangeFilter.between(
                                startOfDay.toInstant(), now.toInstant()
                            )
                        )
                    )
                    val total = response.records.sumOf { it.count }
                    todayLabel.text = "Hoje: $total passos (${response.records.size} registros)"
                } catch (e: Exception) {
                    todayLabel.text = "Hoje: ? (${e.message})"
                }
            }
        }
    }

    private fun requestLocationPerm() {
        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
            PERM_LOCATION_CODE
        )
    }

    private fun requestNotifPerm() {
        if (Build.VERSION.SDK_INT >= 33) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                PERM_NOTIF_CODE
            )
        }
    }

    private fun openDevSettings() {
        try {
            startActivity(Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS))
            Toast.makeText(
                this,
                "Procure \"App de localização simulada\" e escolha Step Tracker",
                Toast.LENGTH_LONG
            ).show()
        } catch (e: Exception) {
            Toast.makeText(
                this,
                "Abra Configurações → Sobre → toque 7x em Número da versão → volta → Opções de Dev → App de localização simulada = Step Tracker",
                Toast.LENGTH_LONG
            ).show()
        }
    }

    private fun openMap() {
        if (!hasLocation()) {
            Toast.makeText(this, "Autorize localização primeiro", Toast.LENGTH_SHORT).show()
            return
        }
        // Pega posição real atual pra passar como ponto inicial
        try {
            val fused = LocationServices.getFusedLocationProviderClient(this)
            fused.lastLocation.addOnSuccessListener { loc ->
                if (loc != null) {
                    saveInitialPosition(loc.latitude, loc.longitude)
                }
                // Abre mapa independente de ter conseguido ou não
                startActivity(Intent(this, MapActivity::class.java))
            }.addOnFailureListener {
                startActivity(Intent(this, MapActivity::class.java))
            }
        } catch (e: SecurityException) {
            startActivity(Intent(this, MapActivity::class.java))
        }
    }

    private fun saveInitialPosition(lat: Double, lon: Double) {
        getSharedPreferences(StepTrackerService.PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putLong(StepTrackerService.KEY_LAT, java.lang.Double.doubleToRawLongBits(lat))
            .putLong(StepTrackerService.KEY_LON, java.lang.Double.doubleToRawLongBits(lon))
            .apply()
    }

    private fun stopService() {
        val intent = Intent(this, StepTrackerService::class.java)
            .setAction(StepTrackerService.ACTION_STOP)
        startService(intent)
        Toast.makeText(this, "Service parado", Toast.LENGTH_SHORT).show()
    }

    override fun onRequestPermissionsResult(
        requestCode: Int, permissions: Array<out String>, grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refreshStatus()
    }
}
