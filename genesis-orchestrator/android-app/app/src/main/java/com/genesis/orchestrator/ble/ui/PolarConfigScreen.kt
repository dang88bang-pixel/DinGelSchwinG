package com.genesis.orchestrator.ble.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BatteryFull
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.genesis.orchestrator.ble.BleConnectionState
import com.genesis.orchestrator.ble.BleDeviceItem
import com.genesis.orchestrator.ble.PolarConfigViewModel

/**
 * The Polar BLE configuration surface.
 *
 * A vertically scrollable list of animated, nested [ExpandableCard]s — the
 * "modern, extensible BLE Polar config UI". New configuration sections are
 * added as additional cards without touching existing ones.
 *
 * Handles the Android 12+ runtime Bluetooth permissions before scanning.
 */
@Composable
fun PolarConfigScreen(viewModel: PolarConfigViewModel = viewModel()) {
    val heartRate by viewModel.heartRate.collectAsState()
    val batteryLevel by viewModel.batteryLevel.collectAsState()
    val connectionState by viewModel.connectionState.collectAsState()
    val isScanning by viewModel.isScanning.collectAsState()
    val devices by viewModel.devices.collectAsState()

    val context = LocalContext.current
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { grants ->
        if (grants.values.all { it }) {
            viewModel.startScan()
        }
    }

    fun ensurePermissionsAndScan() {
        if (hasBluetoothPermissions(context)) {
            viewModel.startScan()
        } else {
            permissionLauncher.launch(bluetoothPermissions())
        }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            PolarConfigExpandableCard(
                heartRate = heartRate,
                batteryLevel = batteryLevel,
                connectionState = connectionState,
                discoveredDevices = devices,
                isScanning = isScanning,
                onStartScan = ::ensurePermissionsAndScan,
                onStopScan = viewModel::stopScan,
                onConnectDevice = viewModel::connect,
                onDisconnect = viewModel::disconnect,
            )
        }

        item {
            MeasurementSettingsCard()
        }

        item {
            DeviceStatusCard(
                heartRate = heartRate,
                batteryLevel = batteryLevel,
                connectionState = connectionState,
                devices = devices,
            )
        }
    }
}

/**
 * Example extensible section: heart-rate alerting thresholds.
 * Demonstrates how the config UI grows with new [ExpandableCard]s.
 */
@Composable
private fun MeasurementSettingsCard() {
    var highRateAlert by remember { mutableStateOf(true) }
    var threshold by remember { mutableStateOf(160) }

    ExpandableCard(
        title = "Mess-Einstellungen",
        subtitle = "Grenzwerte & Benachrichtigungen",
        leadingIcon = {
            Icon(
                imageVector = Icons.Default.Tune,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
            )
        },
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text("Puls-Alarm bei hoher Herzfrequenz", style = MaterialTheme.typography.bodyLarge)
                Text("Warnung bei > $threshold BPM", style = MaterialTheme.typography.bodySmall)
            }
            Switch(checked = highRateAlert, onCheckedChange = { highRateAlert = it })
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Benachrichtigungen aktiv", style = MaterialTheme.typography.bodyLarge)
            Switch(checked = true, onCheckedChange = {})
        }
    }
}

/** Example extensible section: live sensor + device status summary. */
@Composable
private fun DeviceStatusCard(
    heartRate: Int?,
    batteryLevel: Int?,
    connectionState: BleConnectionState,
    devices: List<BleDeviceItem>,
) {
    ExpandableCard(
        title = "Sensor-Status",
        subtitle = "Live-Diagnose der Bridge",
        leadingIcon = {
            Icon(
                imageVector = Icons.Default.BatteryFull,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
            )
        },
    ) {
        StatusRow("Herzfrequenz", heartRate?.let { "$it BPM" } ?: "—")
        StatusRow("Batterie", batteryLevel?.let { "$it %" } ?: "—")
        StatusRow(
            "Verbindung",
            when (connectionState) {
                is BleConnectionState.Connected -> "Verbunden"
                is BleConnectionState.Connecting -> "Verbinde…"
                is BleConnectionState.Error -> "Fehler"
                BleConnectionState.Disconnected -> "Getrennt"
            },
        )
        StatusRow("Geräte gefunden", devices.size.toString())
    }
}

@Composable
private fun StatusRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun hasBluetoothPermissions(context: android.content.Context): Boolean {
    val perms = bluetoothPermissions()
    return perms.all {
        ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
    }
}

private fun bluetoothPermissions(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        arrayOf(
            Manifest.permission.BLUETOOTH_SCAN,
            Manifest.permission.BLUETOOTH_CONNECT,
        )
    } else {
        arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    }
