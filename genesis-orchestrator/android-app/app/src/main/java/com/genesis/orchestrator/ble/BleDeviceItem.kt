package com.genesis.orchestrator.ble

/**
 * A discovered BLE peripheral shown in the Polar config UI.
 */
data class BleDeviceItem(
    val name: String,
    val address: String,
    val rssi: Int,
    val isConnected: Boolean = false,
    val isPolar: Boolean = false,
)

/**
 * Connection lifecycle of the active peripheral.
 */
sealed interface BleConnectionState {
    data object Disconnected : BleConnectionState
    data object Connecting : BleConnectionState
    data object Connected : BleConnectionState
    data class Error(val message: String) : BleConnectionState
}
