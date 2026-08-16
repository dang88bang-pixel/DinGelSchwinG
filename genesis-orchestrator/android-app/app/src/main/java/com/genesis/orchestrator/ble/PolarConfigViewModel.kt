package com.genesis.orchestrator.ble

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

/**
 * UI state holder for the Polar BLE config surface.
 *
 * Exposes the manager's [StateFlow]s to Compose; the device list is converted
 * into a `StateFlow` for stable collection. All sensor updates flow through
 * Coroutines Flows end-to-end.
 */
class PolarConfigViewModel(application: Application) : AndroidViewModel(application) {

    private val bleManager = PolarBleManager(application)

    val heartRate: StateFlow<Int?> = bleManager.heartRate
    val batteryLevel: StateFlow<Int?> = bleManager.batteryLevel
    val connectionState: StateFlow<BleConnectionState> = bleManager.connectionState
    val isScanning: StateFlow<Boolean> = bleManager.isScanning

    val devices: StateFlow<List<BleDeviceItem>> = bleManager.devices
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    fun startScan() = bleManager.startScan()
    fun stopScan() = bleManager.stopScan()
    fun connect(address: String) = bleManager.connect(address)
    fun disconnect() = bleManager.disconnect()

    override fun onCleared() {
        bleManager.close()
    }
}
