package com.genesis.orchestrator.ble.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.BluetoothConnected
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.genesis.orchestrator.ble.BleConnectionState
import com.genesis.orchestrator.ble.BleDeviceItem

/**
 * Modern, extensible "Polar BLE Sensor Bridge" configuration card.
 *
 * Stateless by design: it receives sensor values, the discovered-device list,
 * and callbacks, so it can be dropped into any screen/ViewModel combination.
 * The header shows a live heart-rate readout and connection status; the
 * expanded body lists discovered Polar/NUS devices with RSSI and per-device
 * connect actions.
 */
@Composable
fun PolarConfigExpandableCard(
    heartRate: Int?,
    batteryLevel: Int?,
    connectionState: BleConnectionState,
    discoveredDevices: List<BleDeviceItem>,
    isScanning: Boolean,
    onStartScan: () -> Unit,
    onStopScan: () -> Unit,
    onConnectDevice: (String) -> Unit,
    onDisconnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ExpandableCard(
        title = "Polar BLE Sensor Bridge",
        subtitle = subtitleText(heartRate, connectionState),
        leadingIcon = {
            Icon(
                imageVector = Icons.Default.Favorite,
                contentDescription = "Heart Rate",
                tint = heartRateColor(heartRate),
                modifier = Modifier.size(28.dp),
            )
            Spacer(modifier = Modifier.width(12.dp))
        },
        trailing = {
            when (connectionState) {
                is BleConnectionState.Connected -> IconButton(onClick = onDisconnect) {
                    Icon(
                        imageVector = Icons.Default.BluetoothConnected,
                        contentDescription = "Trennen",
                        tint = Color(0xFF4CAF50),
                    )
                }
                is BleConnectionState.Connecting -> CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                )
                else -> {}
            }
        },
        initiallyExpanded = true,
        modifier = modifier,
    ) {
        HorizontalDivider(modifier = Modifier.padding(bottom = 12.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column {
                Text(
                    text = "Verfügbare Geräte",
                    style = MaterialTheme.typography.labelLarge,
                )
                if (heartRate != null) {
                    Text(
                        text = "Live: $heartRate BPM" +
                            (batteryLevel?.let { " · $it %" } ?: ""),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            IconButton(onClick = if (isScanning) onStopScan else onStartScan) {
                if (isScanning) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                } else {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Scan starten",
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }

        when {
            discoveredDevices.isEmpty() -> Text(
                text = if (isScanning) {
                    "Suche nach Polar/NUS Geräten…"
                } else {
                    "Keine Geräte gefunden — Scan starten."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(vertical = 12.dp),
            )
            else -> DeviceList(
                devices = discoveredDevices,
                onConnectDevice = onConnectDevice,
            )
        }
    }
}

@Composable
private fun DeviceList(
    devices: List<BleDeviceItem>,
    onConnectDevice: (String) -> Unit,
) {
    LazyColumn(
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(max = 240.dp)
            .padding(top = 8.dp),
    ) {
        items(devices, key = { it.address }) { device ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 6.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = if (device.isConnected) {
                            Icons.Default.BluetoothConnected
                        } else {
                            Icons.Default.Bluetooth
                        },
                        contentDescription = null,
                        tint = if (device.isConnected) Color(0xFF4CAF50)
                        else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Column {
                        Text(
                            text = device.name,
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.Medium,
                        )
                        Text(
                            text = "${device.address} · ${device.rssi} dBm",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                Button(
                    onClick = { onConnectDevice(device.address) },
                    enabled = !device.isConnected,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (device.isConnected) {
                            Color.Gray
                        } else {
                            MaterialTheme.colorScheme.primary
                        },
                    ),
                ) {
                    Text(if (device.isConnected) "Aktiv" else "Koppeln")
                }
            }
        }
    }
}

private fun subtitleText(heartRate: Int?, state: BleConnectionState): String = when (state) {
    is BleConnectionState.Connected -> heartRate?.let { "$it BPM" } ?: "Verbunden"
    is BleConnectionState.Connecting -> "Verbindung wird hergestellt…"
    is BleConnectionState.Error -> "Fehler: ${state.message}"
    BleConnectionState.Disconnected -> "Nicht verbunden"
}

private fun heartRateColor(heartRate: Int?): Color =
    if (heartRate != null) Color(0xFFE53935) else Color.Gray
