package com.dingelschwinng.moeagent.devicecontrol

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import com.dingelschwinng.moeagent.devicecontrol.db.DeviceHistoryDb
import com.dingelschwinng.moeagent.devicecontrol.db.UsbVendorDatabase
import com.dingelschwinng.moeagent.devicecontrol.models.ConnectionType
import com.dingelschwinng.moeagent.devicecontrol.models.PortEntry
import com.dingelschwinng.moeagent.devicecontrol.utils.PermissionUtils

/**
 * Automatische Port-View: vereint USB-Host-Erkennung (VID/PID) und
 * ADB-Geraeteliste zu einer Live-Liste.
 *
 *  - UsbManager.getDeviceList() liefert alles, was physisch am USB-Port haengt
 *  - `adb devices` liefert alles, was ADB-seitig autorisiert ist
 *  - BroadcastReceiver reagiert sofort auf An-/Abstecken (kein Polling noetig)
 *  - UsbVendorDatabase uebersetzt VID -> Herstellername
 *  - DeviceHistoryDb protokolliert jedes gesehene Geraet
 */
class DeviceManager(private val context: Context) {

    private val adb = AdbWrapper(context)
    private val vendorDb = UsbVendorDatabase(context)
    private val historyDb = DeviceHistoryDb(context)

    private val _entries = MutableLiveData<List<PortEntry>>(emptyList())
    val entries: LiveData<List<PortEntry>> = _entries

    private var receiverRegistered = false

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            when (intent.action) {
                UsbManager.ACTION_USB_DEVICE_ATTACHED,
                UsbManager.ACTION_USB_DEVICE_DETACHED,
                PermissionUtils.ACTION_USB_PERMISSION ->
                    // ADB-Aufrufe duerfen nie auf dem Main-Thread laufen
                    Thread { refresh() }.start()
            }
        }
    }

    /** BroadcastReceiver registrieren (z. B. in onCreate der Activity). */
    fun start() {
        if (receiverRegistered) return
        val filter = IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
            addAction(PermissionUtils.ACTION_USB_PERMISSION)
        }
        // RECEIVER_EXPORTED: Die Broadcasts kommen vom System (USB_DEVICE_*)
        // bzw. vom UsbManager (Permission-PendingIntent).
        androidx.core.content.ContextCompat.registerReceiver(
            context, receiver, filter,
            androidx.core.content.ContextCompat.RECEIVER_EXPORTED
        )
        receiverRegistered = true
        Thread { refresh() }.start()
    }

    fun stop() {
        if (!receiverRegistered) return
        try { context.unregisterReceiver(receiver) } catch (_: Exception) {}
        receiverRegistered = false
    }

    /**
     * Komplette Liste neu aufbauen (USB + ADB), Hintergrund-Thread empfohlen.
     * Gibt die frische Liste direkt zurueck (LiveData wird zusaetzlich bedient).
     */
    fun refresh(): List<PortEntry> {
        val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager?
        val usbDevices: Map<String, UsbDevice> = usbManager?.deviceList ?: emptyMap()
        val adbDevices = try { adb.getDevices() } catch (_: Exception) { emptyList() }

        val result = mutableListOf<PortEntry>()

        // 1) Physisch verbundene USB-Geraete
        for ((name, device) in usbDevices) {
            val vendor = vendorDb.getVendorName(device.vendorId) ?: "Unbekannter Hersteller"
            val serial = try { device.serialNumber ?: "" } catch (_: SecurityException) { "" }
            val matchingAdb = adbDevices.firstOrNull { serial.isNotEmpty() && it.serial == serial }
            val state = when {
                matchingAdb != null -> matchingAdb.state.raw
                vendorDb.isAndroidVendor(device.vendorId) -> "nicht autorisiert (ADB-Freigabe fehlt)"
                else -> "kein ADB"
            }
            if (serial.isNotEmpty()) {
                historyDb.touchDevice(
                    serial,
                    model = device.productName,
                    manufacturer = vendor,
                    vid = device.vidHex(), pid = device.pidHex(),
                    state = state
                )
            }
            result.add(
                PortEntry(
                    label = device.productName?.ifBlank { null } ?: vendor,
                    serial = serial.ifEmpty { name },
                    vendor = vendor,
                    vid = device.vidHex(), pid = device.pidHex(),
                    state = state,
                    type = ConnectionType.USB,
                    detail = "VID ${device.vidHex()} / PID ${device.pidHex()}"
                )
            )
        }

        // 2) ADB-Geraete, die physisch nicht aufgeloest wurden (z. B. WLAN)
        val knownSerials = result.map { it.serial }.toSet()
        for (dev in adbDevices) {
            if (dev.serial in knownSerials) continue
            val model = if (dev.connected) adb.getProp("ro.product.model", dev.serial) else ""
            result.add(
                PortEntry(
                    label = model.ifBlank { dev.serial },
                    serial = dev.serial,
                    vendor = if (dev.connected) adb.getProp("ro.product.manufacturer", dev.serial) else "",
                    state = dev.state.raw,
                    type = dev.type,
                    detail = if (dev.type == ConnectionType.WIFI) "ADB over WLAN" else "USB"
                )
            )
        }

        _entries.postValue(result)
        return result
    }

    private fun UsbDevice.vidHex(): String = "0x%04x".format(vendorId)
    private fun UsbDevice.pidHex(): String = "0x%04x".format(productId)

    /** Detail-Infos eines verbundenen Geraets per getprop/dumpsys. */
    fun deviceInfo(serial: String): String {
        val props = listOf(
            "ro.product.manufacturer" to "Hersteller",
            "ro.product.model" to "Modell",
            "ro.build.version.release" to "Android",
            "ro.build.version.sdk" to "SDK",
            "ro.build.version.security_patch" to "Security-Patch",
            "ro.boot.flash.locked" to "Bootloader",
            "ro.build.version.incremental" to "Build"
        )
        val sb = StringBuilder()
        for ((prop, label) in props) {
            val value = adb.getProp(prop, serial)
            if (value.isNotEmpty()) sb.appendLine("$label: $value")
        }
        val battery = adb.batteryLevel(serial)
        if (battery in 0..100) sb.appendLine("Akku: $battery %")
        return sb.toString().ifEmpty { "Keine Daten – Geraet nicht erreichbar." }
    }

    /** USB-Freigabe fuer ein Geraet anfordern (fuer die Port-View). */
    fun requestUsbPermission(device: UsbDevice) = PermissionUtils.requestPermission(context, device)

    fun vendorCount(): Int = vendorDb.vendorCount()
    fun recentDevices(limit: Int = 20) = historyDb.recentDevices(limit)
    fun logFlash(serial: String, rom: String, ok: Boolean, error: String?, backup: Boolean) =
        historyDb.logFlash(serial, rom, ok, error, backup)
}
