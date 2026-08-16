package com.genesis.orchestrator.ble

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.util.Log
import java.util.UUID

/**
 * Nordic UART Service (NUS) handler.
 *
 * Implements the standard NUS used by many Nordic-based BLE peripherals:
 *
 *  - Service: 6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *  - RX (write): 6E400002-...  — host -> peripheral
 *  - TX (notify): 6E400003-... — peripheral -> host
 *
 * Used for the e-mobility controllers that expose a NUS bridge to their UART
 * bus (e.g. Ninebot/Xiaomi adapters).
 */
class NordicUartHandler(private val context: Context) {

    companion object {
        private const val TAG = "NordicUartHandler"

        val NUS_SERVICE: UUID = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
        val NUS_RX: UUID = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e")
        val NUS_TX: UUID = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e")
        val CLIENT_CHARACTERISTIC_CONFIG: UUID =
            UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    /** Raw bytes received from the peripheral. */
    var onData: ((ByteArray) -> Unit)? = null
    var onConnectionState: ((Boolean) -> Unit)? = null

    private var gatt: BluetoothGatt? = null

    fun connect(device: BluetoothDevice) {
        gatt = device.connectGatt(context, false, gattCallback)
    }

    fun disconnect() {
        gatt?.disconnect()
        gatt?.close()
        gatt = null
    }

    /** Write bytes to the peripheral's RX characteristic (host -> device). */
    fun write(data: ByteArray) {
        val tx = gatt?.getService(NUS_SERVICE)?.getCharacteristic(NUS_RX) ?: return
        tx.value = data
        gatt?.writeCharacteristic(tx)
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                Log.i(TAG, "Connected to ${gatt.device.address}")
                onConnectionState?.invoke(true)
                gatt.discoverServices()
            } else {
                onConnectionState?.invoke(false)
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val service = gatt.getService(NUS_SERVICE) ?: return
            val rx = service.getCharacteristic(NUS_TX) ?: return

            gatt.setCharacteristicNotification(rx, true)
            rx.getDescriptor(CLIENT_CHARACTERISTIC_CONFIG)?.let { descriptor ->
                descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                gatt.writeDescriptor(descriptor)
            }
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
        ) {
            if (characteristic.uuid == NUS_TX) {
                onData?.invoke(characteristic.value ?: ByteArray(0))
            }
        }
    }
}
