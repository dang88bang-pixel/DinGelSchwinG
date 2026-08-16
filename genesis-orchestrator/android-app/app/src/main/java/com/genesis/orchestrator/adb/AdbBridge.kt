package com.genesis.orchestrator.adb

import android.util.Log
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit

/**
 * ADB Expert USB/WiFi debugging bridge.
 *
 * Shells out to the `adb` binary to enable/disable Android Debug Bridge over
 * WiFi, list connected devices, and forward ports. Intended for the Honeywell
 * CT45 XP, which supports ADB-over-WiFi for service access — mirroring the
 * "gesichertes Terminal für Netzwerkgeräte" use-case.
 *
 * Note: on-device `adb` access requires the binary to be present and may need
 * elevated privileges on production-signed builds.
 */
class AdbBridge(
    private val adbPath: String = "adb",
) {
    companion object {
        private const val TAG = "AdbBridge"
        private const val TIMEOUT_SECONDS = 15L
    }

    /** Result of a single adb invocation. */
    data class AdbResult(val exitCode: Int, val output: String)

    /** List currently connected devices (USB + WiFi). */
    fun listDevices(): AdbResult = run("devices")

    /** Enable ADB over WiFi on port 5555. */
    fun enableWifiDebugging(port: Int = 5555): AdbResult = run("tcpip", port.toString())

    /** Connect to a remote device over WiFi, e.g. "192.168.1.50:5555". */
    fun connect(hostPort: String): AdbResult = run("connect", hostPort)

    /** Disconnect a remote device. */
    fun disconnect(hostPort: String): AdbResult = run("disconnect", hostPort)

    /** Forward a local TCP port to a device port (e.g. the backend socket). */
    fun forward(local: Int, remote: Int): AdbResult =
        run("forward", "tcp:$local", "tcp:$remote")

    /** Execute an arbitrary shell command on the device. */
    fun shell(command: String): AdbResult = run("shell", command)

    private fun run(vararg args: String): AdbResult {
        val cmd = listOf(adbPath) + args
        return try {
            val process = ProcessBuilder(cmd)
                .redirectErrorStream(true)
                .start()

            val output = StringBuilder()
            BufferedReader(InputStreamReader(process.inputStream)).use { reader ->
                reader.forEachLine { output.appendLine(it) }
            }

            val finished = process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)
            if (!finished) {
                process.destroyForcibly()
                Log.w(TAG, "adb command timed out: ${cmd.joinToString(" ")}")
            }
            AdbResult(process.exitValue(), output.toString().trim())
        } catch (e: Exception) {
            Log.e(TAG, "Failed to run adb: ${cmd.joinToString(" ")}", e)
            AdbResult(-1, e.message ?: "adb failed")
        }
    }
}
