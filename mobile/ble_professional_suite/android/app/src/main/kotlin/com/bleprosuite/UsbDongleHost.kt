package com.bleprosuite

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity

/**
 * USB-OTG-Host für BLE-Dongles (nRF52840, CSR8510).
 *
 * Diese Activity wird über den USB_DEVICE_ATTACHED-Filter gestartet,
 * fragt die Nutzerberechtigung für das USB-Gerät an und leitet danach
 * zurück an die MainActivity. Der eigentliche serielle Zugriff erfolgt
 * über das usb_serial-Plugin (siehe UsbDongleService).
 */
class UsbDongleHost : FlutterActivity() {

    companion object {
        private const val ACTION_USB_PERMISSION = "com.bleprosuite.USB_PERMISSION"
    }

    private lateinit var usbManager: UsbManager
    private val permissionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (ACTION_USB_PERMISSION != intent.action) return
            val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
            returnToMain(granted)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        usbManager = getSystemService(Context.USB_SERVICE) as UsbManager

        val device = intent.getParcelableExtra<UsbDevice>(UsbManager.EXTRA_DEVICE)
        if (device == null) {
            returnToMain(false)
            return
        }

        registerReceiver(
            permissionReceiver,
            IntentFilter(ACTION_USB_PERMISSION),
        )

        val pendingIntent = PendingIntent.getBroadcast(
            this,
            0,
            Intent(ACTION_USB_PERMISSION),
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        usbManager.requestPermission(device, pendingIntent)
    }

    private fun returnToMain(granted: Boolean) {
        try {
            unregisterReceiver(permissionReceiver)
        } catch (_: IllegalArgumentException) {
            // Bereits abgemeldet – ignorieren
        }
        val intent = Intent(this, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra("usb_permission_granted", granted)
        }
        startActivity(intent)
        finish()
    }
}
