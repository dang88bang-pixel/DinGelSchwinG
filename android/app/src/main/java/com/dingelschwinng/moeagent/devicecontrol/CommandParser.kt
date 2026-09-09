package com.dingelschwinng.moeagent.devicecontrol

import android.content.Context

/**
 * Sprach-Kommandos (DE/EN) -> ADB/Fastboot-Befehle.
 *
 * Sicherheitsprinzip: Es gibt KEINEN Freiform-Fallback, der beliebige
 * Eingaben als adb-Argumente durchreicht. Unbekannte Eingaben werden mit
 * der Hilfeseite beantwortet; direkte ADB-Befehle muessen mit "adb ..."
 * oder "fastboot ..." beginnen und laufen dann durch die Verb-Whitelist
 * der Wrapper.
 */
class CommandParser(context: Context) {

    private val adb = AdbWrapper(context)
    private val fastboot = FastbootWrapper(context)
    private val toolManager = ToolManager(context)

    /** Fuehrt [input] aus und liefert eine menschenlesbare Antwort. */
    fun parseAndExecute(input: String, targetDevice: String? = null): String {
        val lower = input.lowercase().trim()

        return when {
            // ── Hilfe ────────────────────────────────────────────────
            lower.contains("hilfe") || lower.contains("help") || lower == "?" -> helpText()

            // ── Geraeteverwaltung ───────────────────────────────────
            lower.contains("geräte") || lower.contains("geraete") || lower.contains("devices") -> {
                val devs = adb.getDevices()
                if (devs.isEmpty()) "Keine ADB-Geraete gefunden. USB-Debugging aktiviert?"
                else devs.joinToString("\n") {
                    val stateLabel = when (it.state) {
                        com.dingelschwinng.moeagent.devicecontrol.models.AdbState.DEVICE -> "✅ verbunden"
                        com.dingelschwinng.moeagent.devicecontrol.models.AdbState.UNAUTHORIZED -> "⚠️ nicht autorisiert"
                        com.dingelschwinng.moeagent.devicecontrol.models.AdbState.OFFLINE -> "❌ offline"
                        else -> it.state.raw
                    }
                    "${it.serial} – $stateLabel"
                }
            }

            // ── WLAN-Verbindung ─────────────────────────────────────
            (lower.contains("verbinden") || lower.contains("connect")) && IP_REGEX.containsMatchIn(input) -> {
                val ip = IP_REGEX.find(input)!!.value
                val port = PORT_REGEX.find(input)?.value?.removePrefix(":")?.toIntOrNull() ?: 5555
                adb.connect(ip, port).output
            }

            // ── App-Installation ────────────────────────────────────
            lower.startsWith("install") -> {
                val path = input.substringAfter("install").trim()
                if (path.isEmpty()) "Fehler: Format 'install <APK-Pfad>'"
                else adb.executeCommand("install -r $path", targetDevice, 300).output
            }

            lower.startsWith("deinstall") || lower.startsWith("uninstall") -> {
                val pkg = input.split(" ").getOrNull(1)?.trim() ?: ""
                if (pkg.isEmpty()) "Fehler: Format 'deinstall <paket>'"
                else adb.executeCommand("uninstall $pkg", targetDevice).output
            }

            // ── Cache/Daten ─────────────────────────────────────────
            lower.contains("cache") && (lower.contains("löschen") || lower.contains("loeschen") || lower.contains("clear")) -> {
                // Paketname = letztes Wort der Eingabe
                val pkg = input.trim().split(Regex("\\s+")).lastOrNull().orEmpty()
                if (pkg.isEmpty() || pkg.equals("cache", true) || pkg.equals("löschen", true) ||
                    pkg.equals("loeschen", true) || pkg.equals("clear", true)
                ) "Fehler: Format 'cache löschen <paket>'"
                else adb.executeCommand("shell pm clear $pkg", targetDevice).output
            }

            // ── Shell ───────────────────────────────────────────────
            lower.startsWith("shell ") -> {
                val cmd = input.substringAfter("shell").trim()
                if (cmd.isEmpty()) "Fehler: Format 'shell <befehl>'"
                else adb.executeCommand("shell $cmd", targetDevice).output
            }

            // ── Datei-Transfer ──────────────────────────────────────
            lower.startsWith("pushen") || lower.startsWith("push") -> {
                val rest = if (lower.startsWith("pushen")) input.drop(6) else input.drop(4)
                val parts = AdbWrapper.splitCommand(rest.trim())
                if (parts.size >= 2) adb.executeCommand("push ${parts[0]} ${parts[1]}", targetDevice, 600).output
                else "Fehler: Format 'push <lokal> <remote>'"
            }

            lower.startsWith("pullen") || lower.startsWith("pull") -> {
                val rest = if (lower.startsWith("pullen")) input.drop(6) else input.drop(4)
                val path = rest.trim()
                if (path.isEmpty()) "Fehler: Format 'pull <remote>'"
                else adb.executeCommand("pull $path", targetDevice, 600).output
            }

            // ── Logs & Infos ────────────────────────────────────────
            lower.contains("logcat") || lower.contains("logs") ->
                adb.executeCommand("logcat -d -t 200", targetDevice, 60).output.ifEmpty { "(keine Logs)" }

            lower.contains("akku") || lower.contains("battery") -> {
                val level = adb.batteryLevel(targetDevice)
                if (level in 0..100) "Akkustand: $level %" else "Akkustand nicht ermittelbar."
            }

            lower.contains("screenshot") ->
                adb.executeCommand("shell screencap -p /sdcard/screenshot.png", targetDevice).let {
                    if (it.ok) "Screenshot gespeichert unter /sdcard/screenshot.png (mit 'pull /sdcard/screenshot.png' herunterladen)"
                    else it.output
                }

            lower.contains("neustart") || lower == "reboot" ->
                adb.executeCommand("reboot", targetDevice).output.ifBlank { "Neustart angestoßen." }

            // ── Externe Tools ───────────────────────────────────────
            lower.contains("bugjaeger") -> {
                if (toolManager.checkBugjaeger()) {
                    if (toolManager.launchBugjaeger(targetDevice)) "Bugjaeger gestartet." else "Bugjaeger konnte nicht gestartet werden."
                } else "Bugjaeger ist nicht installiert. Play Store wird geöffnet…"
                    .also { toolManager.openPlayStore(ToolManager.PKG_BUGJAEGER) }
            }

            lower.contains("adbify") -> {
                if (toolManager.checkAdbify()) {
                    if (toolManager.launchAdbify()) "ADBify gestartet." else "ADBify konnte nicht gestartet werden."
                } else "ADBify ist nicht installiert. Play Store wird geöffnet…"
                    .also { toolManager.openPlayStore(ToolManager.PKG_ADBIFY) }
            }

            // ── Fastboot ────────────────────────────────────────────
            lower.contains("bootloader") && (lower.contains("entsperren") || lower.contains("unlock")) ->
                "🛑 Bootloader-Entsperrung läuft aus Sicherheitsgründen nur über den " +
                    "Flash-Assistenten (Pre-Flash-Check + Backup + ausdrückliche Bestätigung)."

            lower.contains("flashen") || lower.startsWith("flash") ->
                "🛑 Flashing läuft ausschließlich über den Flash-Assistenten " +
                    "(Pre-Flash-Check, ARB-Prüfung, Backup-Pflicht). Siehe 'hilfe'."

            lower.contains("fastboot") && lower.contains("reboot") ->
                fastboot.reboot().output.ifBlank { "Fastboot-Neustart angestoßen." }

            lower.contains("fastboot") && lower.contains("geräte") -> {
                val devs = fastboot.getDevices()
                if (devs.isEmpty()) "Keine Fastboot-Geräte gefunden." else devs.joinToString("\n")
            }

            // ── Direkte, explizite Wrapper-Befehle ─────────────────
            lower.startsWith("adb ") ->
                adb.executeCommand(input.substringAfter("adb ").trim(), targetDevice).output

            lower.startsWith("fastboot ") ->
                fastboot.executeCommand(input.substringAfter("fastboot ").trim()).output

            // ── Server-Wartung ──────────────────────────────────────
            lower.contains("adb-server") && lower.contains("restart") -> {
                adb.restartServer()
                "ADB-Server neu gestartet."
            }

            else -> helpText()
        }
    }

    private fun helpText(): String = """
        📖 Verfügbare Befehle:
          • geräte / devices – verbundene Geräte anzeigen
          • verbinden <IP> [Port] – ADB über WLAN verbinden
          • install <APK-Pfad> – App installieren
          • deinstall <Paket> – App deinstallieren
          • cache löschen <Paket> – App-Daten zurücksetzen
          • shell <Befehl> – Shell-Befehl auf dem Gerät
          • push <lokal> <remote> / pull <remote> – Dateitransfer
          • logs / logcat – letzte System-Logs
          • akku – Akkustand des Zielgeräts
          • screenshot – Screenshot aufnehmen
          • reboot – Zielgerät neu starten
          • adb <…> / fastboot <…> – direkte Befehle (Whitelist)
          • adb-server restart – ADB-Server neu starten
          • bugjaeger / adbify – externe Tools starten
        ⚠️ Flashing & Bootloader-Unlock laufen nur über den Flash-Assistenten.
    """.trimIndent()

    companion object {
        private val IP_REGEX = Regex("""\b(?:\d{1,3}\.){3}\d{1,3}\b""")
        private val PORT_REGEX = Regex(""":(\d{2,5})$""")
    }
}
