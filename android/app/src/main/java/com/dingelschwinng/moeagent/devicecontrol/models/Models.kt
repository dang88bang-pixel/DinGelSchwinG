package com.dingelschwinng.moeagent.devicecontrol.models

/**
 * Datenmodelle des Device-Control-Subsystems.
 *
 * Bewusst frei von Android-Abhaengigkeiten, damit Parser, Wrappers und
 * Plugin dieselben Typen teilen koennen.
 */

/** Verbindungsweg eines erkannten Geraets. */
enum class ConnectionType { USB, WIFI, UNKNOWN }

/** Zustand eines ADB-Geraets (Ausgabe von `adb devices`). */
enum class AdbState(val raw: String) {
    DEVICE("device"),
    UNAUTHORIZED("unauthorized"),
    OFFLINE("offline"),
    RECOVERY("recovery"),
    SIDELOAD("sideload"),
    BOOTLOADER("bootloader"),
    UNKNOWN("unknown");

    companion object {
        fun fromRaw(raw: String): AdbState =
            values().firstOrNull { it.raw.equals(raw.trim(), ignoreCase = true) } ?: UNKNOWN
    }
}

/** Ein per ADB erreichbares Geraet. */
data class AdbDevice(
    val serial: String,
    val state: AdbState = AdbState.UNKNOWN,
    val model: String = "",
    val type: ConnectionType = ConnectionType.UNKNOWN
) {
    val connected: Boolean get() = state == AdbState.DEVICE
}

/** Ein per USB-Host-API sichtbares Geraet (Port-View). */
data class UsbPortDevice(
    val deviceName: String,
    val vendorId: Int,
    val productId: Int,
    val productName: String = "",
    val manufacturerName: String = "",
    val serialNumber: String = ""
) {
    val vidHex: String get() = "0x%04x".format(vendorId)
    val pidHex: String get() = "0x%04x".format(productId)
}

/** Vereinheitlichter Eintrag fuer die Port-View. */
data class PortEntry(
    val label: String,
    val serial: String,
    val vendor: String,
    val vid: String = "",
    val pid: String = "",
    val state: String,
    val type: ConnectionType,
    val detail: String = ""
)

/** Chat-Nachricht der nativen Konsole. */
data class ChatMessage(
    val sender: String,
    val text: String,
    val timestamp: Long = System.currentTimeMillis()
)

/** Profil eines Geraets aus der ROM-/Unterstuetzungs-Datenbank. */
data class DeviceProfile(
    val id: String,
    val model: String,
    val codename: String = "",
    val brand: String = "",
    val supportedRoms: List<String> = emptyList(),
    val flashMethod: String = "fastboot",
    val partitions: List<String> = emptyList(),
    val unlockRequired: Boolean = true,
    val arbWarning: String = ""
)

/** Ein Custom-ROM aus der ROM-Datenbank. */
data class RomInfo(
    val id: String,
    val name: String,
    val description: String = "",
    val website: String = "",
    val supportedDevices: List<String> = emptyList()
)

/** Status der Anti-Rollback-Protection. */
data class ArbStatus(
    val arbVersion: String = "",
    val currentFirmware: String = "",
    val bootloaderVersion: String = "",
    val securityPatch: String = "",
    val arbActive: Boolean = false
)

/** Ergebnis der Pre-Flash-Pruefung (Brick-Schutz). */
data class SafetyReport(
    var bootloaderUnlocked: Boolean = false,
    var deviceReachable: Boolean = false,
    var romIntegrityOk: Boolean = false,
    var deviceCompatible: Boolean = false,
    var arbSafe: Boolean = false,
    var batteryOk: Boolean = false,
    val errors: MutableList<String> = mutableListOf(),
    val warnings: MutableList<String> = mutableListOf()
) {
    fun addError(msg: String) { errors.add(msg) }
    fun addWarning(msg: String) { warnings.add(msg) }
    fun isSafe(): Boolean = errors.isEmpty()
    fun summary(): String = buildString {
        append(if (isSafe()) "✅ Flash moeglich" else "🛑 Flash blockiert (${errors.size} Fehler)")
        errors.forEach { append("\n  ✖ ").append(it) }
        warnings.forEach { append("\n  ⚠ ").append(it) }
    }
}

/** Ein Schritt des Flash-Einrichtungsassistenten. */
data class SetupStep(
    val id: String,
    val title: String,
    val description: String,
    val warning: String = ""
)

/** Ergebnis eines Assistenten-Durchlaufs. */
data class SetupResult(
    val success: Boolean,
    val stepsCompleted: List<String>,
    val log: List<String>
)
