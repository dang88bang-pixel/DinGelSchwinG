package com.dingelschwinng.moeagent.devicecontrol.flash

import android.content.Context
import com.dingelschwinng.moeagent.devicecontrol.AdbWrapper

/**
 * Backup-Pflicht vor dem Flashen.
 *
 * Hinweis zu `adb backup`: seit Android 12 markiert Google das Format als
 * veraltet und viele Apps schliessen ihre Daten aus (allowBackup=false).
 * Deshalb liefert der Manager ZUSAETZLICH eine manuelle Checkliste und
 * einen getprop-basierten Daten-Export. Fuer ein echtes Voll-Backup ist
 * ein Custom Recovery (TWRP/OrangeFox -> Nandroid) der richtige Weg –
 * der Assistent bietet das als Schritt an.
 */
class BackupManager(context: Context) {

    private val adb = AdbWrapper(context)

    /** `adb backup` des gesamten Nutzerbereichs in [outputFile]. */
    fun createAdbBackup(outputFile: String, deviceSerial: String?): String {
        val result = adb.execute(
            listOf("backup", "-apk", "-shared", "-all", "-f", outputFile),
            deviceSerial,
            timeoutSeconds = 1800
        )
        return if (result.timedOut) {
            "Backup abgebrochen (Timeout). Prüfen, ob auf dem Gerät die Backup-Bestätigung bestätigt wurde."
        } else {
            result.output.ifBlank {
                "Backup angestoßen. Auf dem Zielgerät muss die Sicherung JETZT bestätigt werden. " +
                    "Ziel: $outputFile (wird im Arbeitsverzeichnis der App angelegt)."
            }
        }
    }

    /** Einfacher Export wichtiger System-Infos als Diagnose-/Wiederherstellungs-Kontext. */
    fun exportDeviceFacts(deviceSerial: String?): String {
        val props = listOf(
            "ro.product.model", "ro.product.device", "ro.build.fingerprint",
            "ro.build.version.release", "ro.build.version.security_patch",
            "persist.sys.timezone"
        )
        return props.joinToString("\n") { "$it=${adb.getProp(it, deviceSerial)}" }
    }

    /** Manuelle Checkliste – wird im Assistenten angezeigt und abgefragt. */
    fun backupChecklist(): List<String> = listOf(
        "Google-Kontakte synchronisiert (Konto -> Synchronisation)",
        "Fotos/Videos gesichert (z. B. USB-Kopie auf das Steuergerät)",
        "WhatsApp-/Messenger-Backup in der App erstellt",
        "2FA-Codes / Authenticator-Backups exportiert",
        "Wichtige Dokumente auf einen PC/Server kopiert",
        "Passwörter/Logins griffbereit",
        "Nandroid-Backup (falls Custom Recovery vorhanden)"
    )
}
