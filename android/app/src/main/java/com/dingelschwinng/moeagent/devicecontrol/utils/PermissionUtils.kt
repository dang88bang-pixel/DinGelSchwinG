package com.dingelschwinng.moeagent.devicecontrol.utils

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build

/**
 * USB-Berechtigungen fuer den USB-Host-Modus.
 *
 * Android verlangt fuer jedes USB-Geraet eine einmalige Nutzerfreigabe;
 * die Freigabe wird ueber einen PendingIntent-Broadcast eingeholt.
 */
object PermissionUtils {

    const val ACTION_USB_PERMISSION = "com.dingelschwinng.moeagent.USB_PERMISSION"

    fun usbManager(context: Context): UsbManager =
        context.getSystemService(Context.USB_SERVICE) as UsbManager

    fun hasPermission(context: Context, device: UsbDevice): Boolean =
        usbManager(context).hasPermission(device)

    /** Fordert die USB-Freigabe fuer [device] an; Ergebnis kommt per Broadcast. */
    fun requestPermission(context: Context, device: UsbDevice) {
        val manager = usbManager(context)
        if (manager.hasPermission(device)) return
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_IMMUTABLE
        } else {
            0
        }
        val pending = PendingIntent.getBroadcast(
            context, 0, Intent(ACTION_USB_PERMISSION).setPackage(context.packageName), flags
        )
        manager.requestPermission(device, pending)
    }
}
