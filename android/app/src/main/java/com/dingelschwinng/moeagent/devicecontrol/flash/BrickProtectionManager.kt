package com.dingelschwinng.moeagent.devicecontrol.flash

import android.content.Context
import com.dingelschwinng.moeagent.devicecontrol.AdbWrapper
import com.dingelschwinng.moeagent.devicecontrol.models.ArbStatus

/**
 * Brick-Schutz, Teil 1: Anti-Rollback-Protection (ARB).
 *
 * Viele Hersteller (Xiaomi, Samsung, OnePlus, Google …) fuehren einen
 * Hardware-Zaehler (eFuse/TrustZone), der bei jeder Firmware-Installation
 * nur nach oben gezaehlt wird. Wird eine Firmware mit NIEDRIGERER
 * ARB-Version geflasht, verweigert das Geraet den Boot – teils
 * dauerhaft. Deshalb:
 *
 *  1. ARB-Version des Geraets auslesen
 *  2. Ziel-ROM darf nur >= der aktuellen ARB-Version sein
 *  3. Bei unbekannter Ziel-ARB-Version: Warnung statt Freigabe
 */
class BrickProtectionManager(context: Context) {

    private val adb = AdbWrapper(context)

    /** Liest alle verfuegbaren ARB-/Firmware-Indikatoren des Geraets aus. */
    fun checkArb(deviceSerial: String?): ArbStatus {
        val arbVersion = adb.getProp("ro.boot.anti_rollback", deviceSerial)
        return ArbStatus(
            arbVersion = arbVersion,
            currentFirmware = adb.getProp("ro.build.version.incremental", deviceSerial),
            bootloaderVersion = adb.getProp("ro.bootloader", deviceSerial),
            securityPatch = adb.getProp("ro.build.version.security_patch", deviceSerial),
            arbActive = arbVersion.isNotBlank() && arbVersion != "0"
        )
    }

    /**
     * Prueft, ob das Ziel-ROM gegenueber der aktuellen ARB-Version sicher ist.
     *
     * @param targetArbVersion ARB-Version des Ziel-ROMs (aus ROM-Metadaten),
     *        leer wenn unbekannt.
     * @return Triple<sicher, Meldung, Warnung>
     */
    fun isDowngradeSafe(
        deviceSerial: String?,
        targetArbVersion: String
    ): Triple<Boolean, String, String> {
        val status = checkArb(deviceSerial)

        if (!status.arbActive) {
            return Triple(true, "ARB nicht aktiv – kein Rollback-Risiko erkannt.", "")
        }

        val current = status.arbVersion.toIntOrNull()
        if (current == null) {
            return Triple(
                false,
                "ARB-Version '${status.arbVersion}' ist nicht numerisch lesbar.",
                "Flash blockiert: ARB-Status unklar."
            )
        }

        if (targetArbVersion.isBlank()) {
            return Triple(
                false,
                "Ziel-ROM enthaelt keine ARB-Angabe.",
                "Flash blockiert: ROM muss eine ARB-Version >= $current deklarieren."
            )
        }

        val target = targetArbVersion.toIntOrNull()
        if (target == null || target < current) {
            return Triple(
                false,
                "Ziel-ARB $targetArbVersion < Geraete-ARB $current – Downgrade!",
                "🛑 BRICK-RISIKO: eFuse-Zaehler wuerde einen Rollback auslösen. " +
                    "Niemals eine Firmware mit niedrigerer ARB-Version flashen."
            )
        }
        return Triple(true, "ARB ok (Ziel $target >= aktuell $current).", "")
    }

    /** Menschenlesbarer Report fuer UI/Chat. */
    fun report(deviceSerial: String?): String {
        val s = checkArb(deviceSerial)
        return buildString {
            appendLine("🛡️ Anti-Rollback-Status:")
            appendLine("  ARB-Version: ${s.arbVersion.ifBlank { "nicht gesetzt" }}")
            appendLine("  ARB aktiv: ${if (s.arbActive) "JA – Downgrades sind gefährlich!" else "nein/unbekannt"}")
            appendLine("  Firmware: ${s.currentFirmware.ifBlank { "?" }}")
            appendLine("  Bootloader: ${s.bootloaderVersion.ifBlank { "?" }}")
            appendLine("  Security-Patch: ${s.securityPatch.ifBlank { "?" }}")
            if (s.arbActive) {
                append("  ⚠️ Vor JEDEM Flash die ARB-Version des Ziel-ROMs prüfen (>= ${s.arbVersion}).")
            }
        }
    }
}
