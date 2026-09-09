package com.dingelschwinng.moeagent.devicecontrol

import android.content.Context
import com.dingelschwinng.moeagent.devicecontrol.models.AdbDevice
import com.dingelschwinng.moeagent.devicecontrol.models.AdbState
import com.dingelschwinng.moeagent.devicecontrol.models.ConnectionType
import com.dingelschwinng.moeagent.devicecontrol.utils.FileUtils
import com.dingelschwinng.moeagent.devicecontrol.utils.ProcessUtils
import java.io.File

/**
 * Wrapper um das eingebettete ARM64-adb-Binary.
 *
 * Das Binary liegt in den Assets (assets/devicecontrol/adb) und wird beim
 * ersten Zugriff nach filesDir kopiert und ausfuehrbar gemacht. Solange dort
 * nur der Platzhalter liegt (kein ELF), melden alle Befehle eine klare
 * Handlungsanweisung statt eines kryptischen Fehlers.
 *
 * Echte ARM64-Binaries liefert scripts/fetch-android-tools.sh
 * (Termux android-tools, Apache-2.0).
 */
class AdbWrapper(private val context: Context) {

    private val adbFile = File(context.filesDir, "adb")
    val adbPath: String get() = adbFile.absolutePath

    /** Erlaubte adb-Unterbefehle (Whitelist gegen Argument-Injection). */
    private val allowedVerbs = setOf(
        "devices", "connect", "disconnect", "shell", "install", "uninstall",
        "push", "pull", "logcat", "reboot", "sideload", "backup", "restore",
        "forward", "reverse", "wait-for-device", "get-state", "kill-server",
        "start-server", "usb", "tcpip", "pair", "bugreport"
    )

    init {
        ensureBinary()
    }

    /**
     * Entpackt das Binary und liefert true, wenn ein echtes ELF vorliegt.
     * Oeffentlich, damit UI/Plugin den Zustand melden kann.
     */
    fun ensureBinary(): Boolean {
        val (_, isReal) = FileUtils.extractAsset(context, "devicecontrol/adb", adbFile)
        return isReal
    }

    val binaryReady: Boolean get() = FileUtils.isElfBinary(adbFile)

    /**
     * Fuehrt einen adb-Befehl aus. [args] enthaelt NUR den Unterbefehl und
     * dessen Argumente (z. B. ["shell", "getprop", "ro.product.model"]).
     */
    fun execute(args: List<String>, deviceSerial: String? = null, timeoutSeconds: Long = 60): ProcessUtils.Result {
        if (!binaryReady) {
            return ProcessUtils.Result(
                -1,
                "ERROR: adb-Binary ist ein Platzhalter.\n" +
                    "Bitte scripts/fetch-android-tools.sh ausfuehren und die App neu bauen."
            )
        }
        val verb = args.firstOrNull()?.lowercase() ?: ""
        if (verb !in allowedVerbs) {
            return ProcessUtils.Result(-1, "ERROR: adb-Unterbefehl '$verb' ist nicht freigegeben.")
        }
        val cmd = mutableListOf(adbPath)
        deviceSerial?.let { cmd.addAll(listOf("-s", it)) }
        cmd.addAll(args)
        return ProcessUtils.run(cmd, timeoutSeconds, context.filesDir)
    }

    /** Bequemer Einstieg fuer den Parser: Befehlsstring wird gesplittet. */
    fun executeCommand(command: String, deviceSerial: String? = null, timeoutSeconds: Long = 60): ProcessUtils.Result {
        val args = splitCommand(command)
        if (args.isEmpty()) return ProcessUtils.Result(-1, "ERROR: leerer Befehl")
        return execute(args, deviceSerial, timeoutSeconds)
    }

    /** Listet alle Geraete auf (`adb devices`). */
    fun getDevices(): List<AdbDevice> {
        val result = execute(listOf("devices"), timeoutSeconds = 20)
        if (!result.ok && result.exitCode != 0) return emptyList()
        return result.output.lines()
            .drop(1) // "List of devices attached"
            .filter { it.isNotBlank() && !it.startsWith("*") }
            .mapNotNull { line ->
                val parts = line.split("\t", limit = 2).map { it.trim() }
                if (parts.isEmpty() || parts[0].isEmpty()) return@mapNotNull null
                val serial = parts[0]
                val state = AdbState.fromRaw(parts.getOrElse(1) { "unknown" })
                val type = if (serial.contains(":")) ConnectionType.WIFI else ConnectionType.USB
                AdbDevice(serial = serial, state = state, type = type)
            }
    }

    /** Verbindet zu einem Geraet ueber WLAN (ADB-TCP, Standardport 5555). */
    fun connect(ip: String, port: Int = 5555): ProcessUtils.Result =
        execute(listOf("connect", "$ip:$port"), timeoutSeconds = 15)

    fun disconnect(ip: String): ProcessUtils.Result =
        execute(listOf("disconnect", ip), timeoutSeconds = 15)

    /** Einzelne System-Property des Zielgeraets auslesen. */
    fun getProp(prop: String, deviceSerial: String?): String =
        execute(listOf("shell", "getprop", prop), deviceSerial, 15).output.trim()

    /** Akku-Stand in Prozent (0..100), -1 bei Fehler. */
    fun batteryLevel(deviceSerial: String?): Int {
        val out = execute(listOf("shell", "dumpsys", "battery"), deviceSerial, 15).output
        val match = Regex("level:\\s*(\\d+)").find(out)
        return match?.groupValues?.get(1)?.toIntOrNull() ?: -1
    }

    /** Startet den ADB-Server neu (Fehlerbehebung). */
    fun restartServer() {
        execute(listOf("kill-server"), timeoutSeconds = 10)
        Thread.sleep(500)
        execute(listOf("start-server"), timeoutSeconds = 15)
    }

    companion object {
        /** Splittet einen Befehlsstring, respektiert einfache Anfuehrungszeichen. */
        fun splitCommand(command: String): List<String> {
            val result = mutableListOf<String>()
            val current = StringBuilder()
            var inQuotes = false
            for (ch in command.trim()) {
                when {
                    ch == '\'' -> inQuotes = !inQuotes
                    ch == ' ' && !inQuotes -> {
                        if (current.isNotEmpty()) { result.add(current.toString()); current.clear() }
                    }
                    else -> current.append(ch)
                }
            }
            if (current.isNotEmpty()) result.add(current.toString())
            return result
        }
    }
}
