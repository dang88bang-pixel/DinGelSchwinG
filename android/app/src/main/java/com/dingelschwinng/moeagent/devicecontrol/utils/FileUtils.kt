package com.dingelschwinng.moeagent.devicecontrol.utils

import android.content.Context
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.security.MessageDigest

/**
 * Datei-Helfer fuer das Device-Control-Subsystem:
 * Entpacken der Binaries aus den Assets, Integritaetspruefung (SHA-256).
 */
object FileUtils {

    /** ELF-Magic; echte adb/fastboot-Binaries beginnen damit. */
    private val ELF_MAGIC = byteArrayOf(0x7f, 'E'.code.toByte(), 'L'.code.toByte(), 'F'.code.toByte())

    /**
     * Entpackt [assetName] nach [destFile], wenn die Datei fehlt oder sich
     * die Groesse geaendert hat, und setzt Ausfuehrungsrechte.
     *
     * @return Pair<Datei, istEchtBinary> – istEchtBinary=false bedeutet,
     *         dass noch der Platzhalter liegt (scripts/fetch-android-tools.sh
     *         wurde nicht ausgefuehrt).
     */
    fun extractAsset(context: Context, assetName: String, destFile: File): Pair<File, Boolean> {
        val assetSize = try {
            context.assets.openFd(assetName).use { it.length }
        } catch (_: Exception) { -1L }

        // Neu extrahieren, wenn die Datei fehlt, noch ein Platzhalter (kein ELF)
        // liegt oder die Groesse nicht mehr zum Asset passt.
        val needsCopy = !destFile.exists() ||
            (!isElfBinary(destFile)) ||
            (assetSize > 0 && destFile.length() != assetSize)

        if (needsCopy) {
            context.assets.open(assetName).use { input ->
                FileOutputStream(destFile).use { output -> input.copyTo(output) }
            }
        }
        destFile.setExecutable(true, true)
        destFile.setReadable(true, false)
        return destFile to isElfBinary(destFile)
    }

    /** true, wenn die Datei mit dem ELF-Magic beginnt (echtes ARM64-Binary). */
    fun isElfBinary(file: File): Boolean {
        if (!file.exists() || file.length() < 4) return false
        return try {
            FileInputStream(file).use { fis ->
                val head = ByteArray(4)
                if (fis.read(head) != 4) return false
                head.contentEquals(ELF_MAGIC)
            }
        } catch (_: Exception) { false }
    }

    /** SHA-256-Pruefsumme (Hex) fuer ROM-/Firmware-Dateien. */
    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { fis ->
            val buf = ByteArray(1 shl 16)
            while (true) {
                val n = fis.read(buf)
                if (n <= 0) break
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}
