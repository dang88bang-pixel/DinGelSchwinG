package com.genesis.orchestrator.ble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Flow-based Polar BLE manager.
 *
 * Exposes continuous sensor telemetry (heart rate, battery) and device
 * discovery as [StateFlow]s so the Compose UI can `collectAsState()` them
 * reactively — no manual listener bookkeeping. This is the canonical
 * implementation of the "Kotlin Coroutines Flows für kontinuierliche
 * Heartbeat/Telemetry-Updates" requirement.
 *
 * Requires `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` (API 31+) or
 * `ACCESS_FINE_LOCATION` (<= API 30) to be granted by the caller.
 */
class PolarBleManager(private val context: Context) {

    companion object {
        private const val TAG = "PolarBleManager"

        // Bluetooth SIG standard services/characteristics.
        val HEART_RATE_SERVICE: UUID = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
        val HEART_RATE_MEASUREMENT: UUID = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
        val BATTERY_SERVICE: UUID = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
        val BATTERY_LEVEL: UUID = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")
        val CLIENT_CHARACTERISTIC_CONFIG: UUID =
            UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val adapter: BluetoothAdapter?
        get() = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private var gatt: BluetoothGatt? = null
    private var scanJob: Job? = null
    private var connectedAddress: String? = null

    // --- Observable state (Flows) -----------------------------------------

    private val _heartRate = MutableStateFlow<Int?>(null)
    /** Continuous heart-rate updates (BPM), `null` when not connected. */
    val heartRate: StateFlow<Int?> = _heartRate.asStateFlow()

    private val _batteryLevel = MutableStateFlow<Int?>(null)
    /** Polar battery level (0-100), `null` when unknown. */
    val batteryLevel: StateFlow<Int?> = _batteryLevel.asStateFlow()

    private val _connectionState = MutableStateFlow<BleConnectionState>(BleConnectionState.Disconnected)
    val connectionState: StateFlow<BleConnectionState> = _connectionState.asStateFlow()

    private val _isScanning = MutableStateFlow(false)
    val isScanning: StateFlow<Boolean> = _isScanning.asStateFlow()

    private val _devices = MutableStateFlow<List<BleDeviceItem>>(emptyList())
    val devices: StateFlow<List<BleDeviceItem>> = _devices.asStateFlow()

    // --- Scanning ----------------------------------------------------------

    /** Raw BLE scan results as a cold [Flow]; cancelled when the collector stops. */
    @SuppressLint("MissingPermission")
    private fun scanResults(): Flow<ScanResult> = callbackFlow {
        val scanner = adapter?.bluetoothLeScanner
        if (scanner == null) {
            close(IllegalStateException("BLE scanner not available"))
            return@callbackFlow
        }
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                trySend(result)
            }

            override fun onScanFailed(errorCode: Int) {
                Log.e(TAG, "BLE scan failed, error=$errorCode")
                close(IllegalStateException("BLE scan failed ($errorCode)"))
            }
        }
        scanner.startScan(callback)
        awaitClose { scanner.stopScan(callback) }
    }

    /** Begin scanning and accumulate discovered devices (deduped by address). */
    @SuppressLint("MissingPermission")
    fun startScan() {
        if (scanJob?.isActive == true) return
        _isScanning.value = true
        scanJob = scope.launch {
            try {
                scanResults().collect { result ->
                    val device = result.device
                    val name = device.name ?: "Unbekannt"
                    val item = BleDeviceItem(
                        name = name,
                        address = device.address,
                        rssi = result.rssi,
                        isConnected = device.address == connectedAddress,
                        isPolar = isPolarDevice(name),
                    )
                    val updated = _devices.value.toMutableList()
                    val index = updated.indexOfFirst { it.address == device.address }
                    if (index >= 0) updated[index] = item else updated.add(item)
                    _devices.value = updated.sortedByDescending { it.rssi }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Scan aborted", e)
            } finally {
                _isScanning.value = false
            }
        }
    }

    fun stopScan() {
        scanJob?.cancel()
        scanJob = null
        _isScanning.value = false
    }

    // --- Connection --------------------------------------------------------

    @SuppressLint("MissingPermission")
    fun connect(address: String) {
        val device = adapter?.getRemoteDevice(address) ?: return
        connectedAddress = address
        _connectionState.value = BleConnectionState.Connecting
        gatt?.close()
        gatt = device.connectGatt(context, false, gattCallback)
    }

    fun disconnect() {
        gatt?.disconnect()
        gatt?.close()
        gatt = null
        connectedAddress = null
        _heartRate.value = null
        _batteryLevel.value = null
        _connectionState.value = BleConnectionState.Disconnected
    }

    fun close() {
        stopScan()
        disconnect()
        scope.cancel()
    }

    private fun isPolarDevice(name: String): Boolean =
        listOf("polar", "h10", "h9", "verity", "oh1", "grit").any { tag ->
            name.contains(tag, ignoreCase = true)
        }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    Log.i(TAG, "Connected to ${gatt.device.address}")
                    _connectionState.value = BleConnectionState.Connected
                    gatt.discoverServices()
                }
                else -> {
                    Log.i(TAG, "Disconnected (status=$status)")
                    _connectionState.value = BleConnectionState.Disconnected
                    _heartRate.value = null
                    _batteryLevel.value = null
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            subscribeNotifications(gatt, HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT)
            subscribeNotifications(gatt, BATTERY_SERVICE, BATTERY_LEVEL)
            // Battery level is typically read once after discovery.
            readBattery(gatt)
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
        ) {
            when (characteristic.uuid) {
                HEART_RATE_MEASUREMENT -> parseHeartRate(characteristic.value)?.let {
                    _heartRate.value = it
                }
                BATTERY_LEVEL -> parseUint8(characteristic.value)?.let {
                    _batteryLevel.value = it
                }
            }
        }

        override fun onCharacteristicRead(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int,
        ) {
            if (status == BluetoothGatt.GATT_SUCCESS && characteristic.uuid == BATTERY_LEVEL) {
                parseUint8(characteristic.value)?.let { _batteryLevel.value = it }
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun subscribeNotifications(gatt: BluetoothGatt, serviceUuid: UUID, charUuid: UUID) {
        val characteristic = gatt.getService(serviceUuid)?.getCharacteristic(charUuid) ?: return
        gatt.setCharacteristicNotification(characteristic, true)
        characteristic.getDescriptor(CLIENT_CHARACTERISTIC_CONFIG)?.let { descriptor ->
            descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            gatt.writeDescriptor(descriptor)
        }
    }

    @SuppressLint("MissingPermission")
    private fun readBattery(gatt: BluetoothGatt) {
        gatt.getService(BATTERY_SERVICE)?.getCharacteristic(BATTERY_LEVEL)?.let {
            gatt.readCharacteristic(it)
        }
    }

    private fun parseUint8(data: ByteArray?): Int? = data?.firstOrNull()?.toInt()?.and(0xFF)

    /** Decode HR per the Bluetooth SIG spec (flags byte + value, 8- or 16-bit). */
    private fun parseHeartRate(data: ByteArray?): Int? {
        if (data == null || data.size < 2) return null
        val flags = data[0].toInt() and 0xFF
        val isUint16 = flags and 0x01 != 0
        return if (isUint16) {
            if (data.size < 3) null
            else (data[1].toInt() and 0xFF) or ((data[2].toInt() and 0xFF) shl 8)
        } else {
            data[1].toInt() and 0xFF
        }
    }
}
