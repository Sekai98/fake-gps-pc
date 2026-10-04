package com.stepinjector

import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/**
 * PoC v0.1.0 — Botão único que injeta 1000 passos no Health Connect.
 * Depois a gente valida se Mooney/Weward leem.
 */
class MainActivity : AppCompatActivity() {

    private var healthConnectClient: HealthConnectClient? = null
    private lateinit var status: TextView
    private lateinit var btnInject: Button
    private lateinit var lastEvent: TextView
    private lateinit var todayTotal: TextView

    private val requiredPermissions = setOf(
        HealthPermission.getWritePermission(StepsRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class)
    )

    private val requestPermissions = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { granted ->
        if (granted.containsAll(requiredPermissions)) {
            status.text = "✓ Permissões concedidas"
            btnInject.isEnabled = true
            refreshToday()
        } else {
            status.text = "✗ Permissões negadas — abra Health Connect e autorize"
            btnInject.isEnabled = false
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        status = findViewById(R.id.status)
        btnInject = findViewById(R.id.btn_inject)
        lastEvent = findViewById(R.id.last_event)
        todayTotal = findViewById(R.id.today_total)

        // Verifica disponibilidade do Health Connect
        val availability = HealthConnectClient.getSdkStatus(this)
        when (availability) {
            HealthConnectClient.SDK_AVAILABLE -> {
                healthConnectClient = HealthConnectClient.getOrCreate(this)
                btnInject.setOnClickListener { inject1000() }
                checkPermissions()
            }
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                status.text = "✗ Health Connect precisa ser atualizado. Abra a Play Store."
                btnInject.isEnabled = false
            }
            else -> {
                status.text = "✗ Health Connect não instalado. Instale via Play Store."
                btnInject.isEnabled = false
            }
        }
    }

    private fun checkPermissions() {
        val client = healthConnectClient ?: return
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val granted = client.permissionController.getGrantedPermissions()
                if (granted.containsAll(requiredPermissions)) {
                    status.text = "✓ Health Connect pronto"
                    btnInject.isEnabled = true
                    refreshToday()
                } else {
                    status.text = "⚠ Clique abaixo pra autorizar permissões"
                    requestPermissions.launch(requiredPermissions)
                }
            } catch (e: Exception) {
                status.text = "Erro ao checar permissões: ${e.message}"
            }
        }
    }

    private fun inject1000() {
        val client = healthConnectClient ?: return
        btnInject.isEnabled = false
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val now = ZonedDateTime.now()
                val durationSec = 600L  // 10 minutos "virtuais" pra 1000 passos (cadência 100/min, realista)
                val start = now.minusSeconds(durationSec)

                val record = StepsRecord(
                    count = 1000,
                    startTime = start.toInstant(),
                    startZoneOffset = start.offset,
                    endTime = now.toInstant(),
                    endZoneOffset = now.offset
                )

                client.insertRecords(listOf(record))

                val fmt = DateTimeFormatter.ofPattern("HH:mm:ss")
                lastEvent.text = "Último: 1000 passos às ${now.format(fmt)}"
                Toast.makeText(
                    this@MainActivity,
                    "✓ 1000 passos injetados",
                    Toast.LENGTH_SHORT
                ).show()
                refreshToday()
            } catch (e: Exception) {
                Toast.makeText(
                    this@MainActivity,
                    "Erro na injeção: ${e.message}",
                    Toast.LENGTH_LONG
                ).show()
                lastEvent.text = "✗ Erro: ${e.message}"
            } finally {
                btnInject.isEnabled = true
            }
        }
    }

    private fun refreshToday() {
        val client = healthConnectClient ?: return
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val now = ZonedDateTime.now()
                val startOfDay = now.toLocalDate().atStartOfDay(ZoneId.systemDefault())

                val response = client.readRecords(
                    ReadRecordsRequest(
                        recordType = StepsRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(
                            startOfDay.toInstant(),
                            now.toInstant()
                        )
                    )
                )
                val total = response.records.sumOf { it.count }
                todayTotal.text = "Hoje: $total passos (${response.records.size} registros)"
            } catch (e: Exception) {
                todayTotal.text = "Erro leitura: ${e.message}"
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Atualiza total quando voltar pra app (caso tenha mudado no Mooney/Weward)
        if (healthConnectClient != null && btnInject.isEnabled) {
            refreshToday()
        }
    }
}
