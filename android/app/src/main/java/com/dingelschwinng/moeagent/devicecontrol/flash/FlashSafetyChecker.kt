package com.dingelschwinng.moeagent.devicecontrol.flash

import android.content.Context
import com.dingelschwinng.moeagent.devicecontrol.AdbWrapper
import com.dingelschwinng.moeagent.devicecontrol.models.DeviceProfile
import com.dingelschwinng.moeagent.devicecontrol.models.SafetyReport
import com.dingelschwinng.moeagent.devicecontrol.utils.FileUtils
import java.io.File

/**
 * Brick-Schutz, Teil 2: Pre-Flash-Checkliste.
 *
 * Jeder Flash-Vorgang MUSS vorher hier durch. Blockiert wird bei:
 *  - Geraet nicht erreichbar
 *  - Bootloader nicht entsperrt (falls Unlock noetig)
 *  - ROM-Datei fehlt oder SHA-256 stimmt nicht (falls Soll-Wert bekannt)
 *  - ROM nicht fuer das Geraet freigegeben
 *  - ARB-Downgrade
 * Gewarnt (nicht blockiert) wird bei niedrigem Akku (< 60 %).
 */
class FlashSafetyChecker(context: Context) {

    private val adb = AdbWrapper(context)
    private val arb = BrickProtectionManager(context)

    fun preFlashCheck(
        deviceSerial: String?,
        profile: DeviceProfile?,
        romFile: File?,
        expectedSha256: String?,
        targetArbVersion: String
    ): SafetyReport {
        val report = SafetyReport()

        // 1) Erreichbarkeit
        val devices = adb.getDevices()
        val device = devices.firstOrNull { it.serial == deviceSerial } ?: devices.firstOrNull()
        if (device == null) {
            report.addError("Kein ADB-Gerät erreichbar. USB-Debugging + Kabel prüfen.")
        } else {
            report.deviceReachable = true
        }

        // 2) Bootloader-Status (nur sinnvoll, wenn ein Fastboot-Geraet sichtbar ist
        //    oder der Unlock erforderlich ist)
        if (profile?.unlockRequired == true) {
            val lockedProp = adb.getProp("ro.boot.flash.locked", deviceSerial)
            when {
                lockedProp == "0" -> report.bootloaderUnlocked = true
                lockedProp == "1" -> report.addError(
                    "Bootloader ist GESPERRT. Erst über den Assistenten entsperren (löscht alle Daten!)."
                )
                else -> report.addWarning(
                    "Bootloader-Status per getprop nicht lesbar – im Fastboot-Modus mit 'fastboot getvar unlocked' prüfen."
                )
            }
        } else {
            report.bootloaderUnlocked = true
        }

        // 3) ROM-Integritaet (SHA-256)
        if (romFile == null || !romFile.exists()) {
            report.addError("ROM-Datei existiert nicht: ${romFile?.absolutePath ?: "<keine>"}")
        } else {
            if (expectedSha256.isNullOrBlank()) {
                report.addWarning(
                    "Keine Soll-Prüfsumme angegeben – Integrität nicht verifiziert. " +
                        "SHA-256 der Datei: ${FileUtils.sha256(romFile)}"
                )
                report.romIntegrityOk = true // ohne Soll-Wert nicht blockierend
            } else {
                val actual = FileUtils.sha256(romFile)
                if (actual.equals(expectedSha256, ignoreCase = true)) {
                    report.romIntegrityOk = true
                } else {
                    report.addError("SHA-256 stimmt nicht! Erwartet $expectedSha256, bekommen $actual.")
                }
            }
        }

        // 4) Kompatibilitaet
        if (profile == null) {
            report.addError("Kein Geräteprofil gefunden – Codename/Modell prüfen.")
        } else {
            val model = adb.getProp("ro.product.device", deviceSerial)
            if (model.isNotBlank() && profile.codename.isNotBlank() && !model.equals(profile.codename, true)) {
                report.addError(
                    "ROM ist für '${profile.codename}', aber am Port hängt '$model'. " +
                        "Falsche Firmware = garantierter Brick."
                )
            } else {
                report.deviceCompatible = true
            }
        }

        // 5) ARB-Downgrade-Schutz
        val (arbOk, arbMsg, arbWarn) = arb.isDowngradeSafe(deviceSerial, targetArbVersion)
        report.arbSafe = arbOk
        if (!arbOk) report.addError(arbMsg)
        if (arbWarn.isNotEmpty()) report.addWarning(arbWarn)

        // 6) Akku
        val level = adb.batteryLevel(deviceSerial)
        if (level in 0 until 60) {
            report.addWarning("Akkustand $level % < 60 % – Gerät während des Flash an Strom anschließen!")
        } else {
            report.batteryOk = level >= 60
        }

        return report
    }
}
