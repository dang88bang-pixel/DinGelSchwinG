package com.dingelschwinng.moeagent.devicecontrol.flash

import android.content.Context
import com.dingelschwinng.moeagent.devicecontrol.AdbWrapper
import com.dingelschwinng.moeagent.devicecontrol.FastbootWrapper
import com.dingelschwinng.moeagent.devicecontrol.db.DeviceHistoryDb
import com.dingelschwinng.moeagent.devicecontrol.models.DeviceProfile
import com.dingelschwinng.moeagent.devicecontrol.models.SetupResult
import com.dingelschwinng.moeagent.devicecontrol.models.SetupStep
import com.dingelschwinng.moeagent.devicecontrol.rom.RomRepository
import java.io.File

/**
 * Flash-Einrichtungsassistent: gefuehrte Abfolge mit Brick-Schutz.
 *
 * Schritte:
 *   1. prepare  – Geraete-Infos + Backup-Hinweise
 *   2. unlock   – Bootloader entsperren (NUR nach Pre-Flash-Check +
 *                 ausdruecklicher Bestaetigung; loescht ALLE Daten)
 *   3. recovery – Custom Recovery flashen (optional)
 *   4. flash    – Partitionen des gewaehlten ROMs flashen
 *   5. finish   – Neustart + Historieneintrag
 *
 * Der Assistent fuehrt einen Schritt NUR aus, wenn der vorherige
 * Safety-Check erfolgreich war; jeder Schritt wird protokolliert.
 */
class FlashSetupWizard(
    private val context: Context,
    private val deviceSerial: String?
) {
    private val adb = AdbWrapper(context)
    private val fastboot = FastbootWrapper(context)
    private val safety = FlashSafetyChecker(context)
    private val history = DeviceHistoryDb(context)

    fun steps(): List<SetupStep> = listOf(
        SetupStep(
            "prepare", "📋 Vorbereitung",
            "Backup erstellen, ROM herunterladen, Prüfwerte (SHA-256, ARB) besorgen."
        ),
        SetupStep(
            "unlock", "🔓 Bootloader entsperren",
            "Der Bootloader muss entsperrt werden.",
            warning = "⚠️ Alle Daten werden gelöscht! Nur mit vorhandenem Backup fortfahren. " +
                "Garantie kann verloren gehen."
        ),
        SetupStep(
            "recovery", "📲 Custom Recovery installieren (optional)",
            "TWRP/OrangeFox flashen, falls das ROM einen Recovery-Flash braucht."
        ),
        SetupStep(
            "flash", "🚀 ROM flashen",
            "Partitionen gemäß Geräteprofil flashen."
        ),
        SetupStep(
            "finish", "✅ Abschluss",
            "Gerät neu starten und Flash protokollieren."
        )
    )

    /** Schritt 1: Vorbereitung – Infos sammeln. */
    fun prepare(): String = buildString {
        appendLine("=== Vorbereitung ===")
        appendLine("Bootloader: ${adb.getProp("ro.boot.flash.locked", deviceSerial).let { if (it == "1") "GESPERRT" else if (it == "0") "offen" else "unbekannt" }}")
        appendLine("Gerät: ${adb.getProp("ro.product.manufacturer", deviceSerial)} ${adb.getProp("ro.product.model", deviceSerial)}")
        appendLine("Codename: ${adb.getProp("ro.product.device", deviceSerial)}")
        appendLine()
        appendLine("Backup-Checkliste:")
        BackupManager(context).backupChecklist().forEach { appendLine("  ☐ $it") }
    }

    /** Schritt 2: Unlock – verlangt [userConfirmed] UND bestandenen Safety-Check. */
    fun unlock(userConfirmed: Boolean): SetupResult {
        if (!userConfirmed) {
            return SetupResult(false, emptyList(), listOf("Abgebrochen: keine Nutzerbestätigung."))
        }
        val report = safety.preFlashCheck(deviceSerial, null, null, null, "")
        val log = mutableListOf("=== Bootloader-Unlock ===")
        log.add("Pre-Flash-Check: ${if (report.deviceReachable) "Gerät erreichbar" else "Gerät NICHT erreichbar"}")
        if (!report.deviceReachable) {
            return SetupResult(false, emptyList(), log + report.errors)
        }
        log.add("Gerät wird in den Bootloader neu gestartet …")
        adb.execute(listOf("reboot", "bootloader"), deviceSerial, 30)
        Thread.sleep(4000)
        val result = fastboot.unlockBootloader()
        log.add(result.output.ifBlank { "(keine Ausgabe – Bestätigung am Gerät nötig)" })
        log.add("Hinweis: Viele Geräte zeigen den Unlock jetzt AM GERÄT an und verlangen eine Tasten-Bestätigung.")
        history.logFlash(deviceSerial ?: "?", "bootloader-unlock", result.exitCode == 0, result.output, false)
        return SetupResult(result.exitCode == 0, listOf("unlock"), log)
    }

    /** Schritt 3: Custom Recovery flashen. */
    fun flashRecovery(imageFile: File, expectedSha256: String?): SetupResult {
        val log = mutableListOf("=== Custom Recovery ===")
        if (!imageFile.exists()) return SetupResult(false, emptyList(), log + "Datei fehlt: $imageFile")
        val report = safety.preFlashCheck(deviceSerial, null, imageFile, expectedSha256, "")
        if (report.errors.isNotEmpty()) {
            return SetupResult(false, emptyList(), log + report.errors)
        }
        val result = fastboot.flashRecovery(imageFile.absolutePath)
        log.add(result.output)
        return SetupResult(result.exitCode == 0, listOf("recovery"), log)
    }

    /** Schritt 4: ROM flashen (Fastboot-Methode, Partitionen aus dem Profil). */
    fun flashRom(profile: DeviceProfile, romDir: File, targetArbVersion: String): SetupResult {
        val log = mutableListOf("=== ROM flashen: ${profile.id} ===")
        if (profile.flashMethod != "fastboot") {
            return SetupResult(
                false, emptyList(),
                log + "Dieses ROM nutzt die Methode '${profile.flashMethod}' – " +
                    "bitte über Custom Recovery (adb sideload) installieren."
            )
        }
        // Safety-Check je zu flashender Partition (Integritaet + Kompatibilitaet + ARB)
        for (partition in profile.partitions) {
            val img = File(romDir, "$partition.img")
            if (!img.exists()) {
                log.add("⏭ Partition '$partition': keine ${img.name} im ROM-Verzeichnis – übersprungen.")
                continue
            }
            val report = safety.preFlashCheck(deviceSerial, profile, img, null, targetArbVersion)
            if (!report.isSafe()) {
                log.add("🛑 Partition '$partition' blockiert:")
                log.addAll(report.errors.map { "   ✖ $it" })
                history.logFlash(deviceSerial ?: "?", profile.id, false, report.errors.joinToString("; "), false)
                return SetupResult(false, emptyList(), log)
            }
            val result = fastboot.flash(partition, img.absolutePath)
            log.add("${partition}: ${if (result.exitCode == 0) "✅" else "❌"} ${result.output.takeLast(300)}")
            if (result.exitCode != 0) {
                history.logFlash(deviceSerial ?: "?", profile.id, false, "Partition $partition fehlgeschlagen", false)
                return SetupResult(false, listOf("flash-partial"), log + "ABBRUCH: Keine weitere Partition geflasht (Brick-Schutz).")
            }
        }
        history.logFlash(deviceSerial ?: "?", profile.id, true, null, false)
        return SetupResult(true, listOf("flash"), log)
    }

    /** Schritt 5: Neustart. */
    fun finish(): SetupResult {
        val result = fastboot.reboot()
        return SetupResult(true, listOf("finish"), listOf("Neustart angestoßen.", result.output))
    }

    /** Komfort: ROMs auflisten, die zum erkannten Geraet passen. */
    fun matchingRoms(): String {
        val codename = adb.getProp("ro.product.device", deviceSerial)
        val repo = RomRepository(context)
        val profile = repo.findProfile(codename)
            ?: return "Kein Geräteprofil für Codename '$codename' in der Datenbank."
        val roms = repo.roms().filter { profile.id in it.supportedDevices || profile.codename in it.supportedDevices }
        return buildString {
            appendLine("Profil: ${profile.model} (${profile.codename}), Methode: ${profile.flashMethod}")
            if (profile.arbWarning.isNotBlank()) appendLine("⚠️ ${profile.arbWarning}")
            if (roms.isEmpty()) append("Keine ROMs für dieses Profil hinterlegt.")
            else roms.forEach { appendLine("  • ${it.name} – ${it.website}") }
        }
    }
}
