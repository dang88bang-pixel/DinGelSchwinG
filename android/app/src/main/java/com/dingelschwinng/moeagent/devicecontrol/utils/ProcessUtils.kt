package com.dingelschwinng.moeagent.devicecontrol.utils

import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Prozess-Ausfuehrung fuer die eingebetteten adb/fastboot-Binaries.
 *
 * Zentrale Regeln:
 *  - kein Argument wird durch eine Shell gejagt (ProcessBuilder mit
 *    Argumentliste, keine `sh -c`), dadurch kein Shell-Injection-Pfad;
 *  - harte Timeouts, damit ein haengender ADB-Daemon die UI nicht blockiert;
 *  - stdout+stderr zusammengefuehrt, Exit-Code wird mitgeliefert.
 */
object ProcessUtils {

    data class Result(val exitCode: Int, val output: String, val timedOut: Boolean = false) {
        val ok: Boolean get() = exitCode == 0 && !timedOut
    }

    /** Fuehrt [command] (Programm + Argumente) mit Timeout aus. */
    fun run(command: List<String>, timeoutSeconds: Long = 60, workDir: File? = null): Result {
        return try {
            val builder = ProcessBuilder(command)
                .redirectErrorStream(true)
            if (workDir != null) builder.directory(workDir)

            // ADB_HOME vermeidet, dass adb eine ~/.android/adb_usb.ini o. ae.
            // an ungeeigneter Stelle anlegt; ADB_SERVER_SOCKET bleibt lokal.
            val env = builder.environment()
            env["HOME"] = workDir?.absolutePath ?: "/data/local/tmp"

            val process = builder.start()
            val reader = process.inputStream.bufferedReader()
            val sb = StringBuilder()

            // Lesen in eigenem Thread, damit waitFor() nicht am vollen
            // Pipe-Puffer blockiert.
            val readThread = Thread {
                try {
                    reader.forEachLine { line ->
                        synchronized(sb) { sb.appendLine(line) }
                    }
                } catch (_: IOException) {
                    // Stream geschlossen beim Beenden – ok
                }
            }
            readThread.isDaemon = true
            readThread.start()

            val finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS)
            if (!finished) {
                process.destroyForcibly()
                readThread.join(1000)
                Result(-1, snapshot(sb) + "\n[TIMEOUT nach ${timeoutSeconds}s – Prozess beendet]", true)
            } else {
                readThread.join(2000)
                Result(process.exitValue(), snapshot(sb).trimEnd())
            }
        } catch (e: Exception) {
            Result(-1, "ERROR: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    private fun snapshot(sb: StringBuilder): String =
        synchronized(sb) { sb.toString() }
}
