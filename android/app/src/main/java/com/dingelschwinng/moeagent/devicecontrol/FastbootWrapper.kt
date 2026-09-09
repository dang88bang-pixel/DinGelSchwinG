package com.dingelschwinng.moeagent.devicecontrol

import android.content.Context
import com.dingelschwinng.moeagent.devicecontrol.utils.FileUtils
import com.dingelschwinng.moeagent.devicecontrol.utils.ProcessUtils
import java.io.File

/**
 * Wrapper um das eingebettete ARM64-fastboot-Binary.
 *
 * Geraete im Fastboot-/Bootloader-Modus werden per USB-OTG erreicht.
 * Fuer alle zerstoerenden Operationen (unlock, flash, erase) gilt:
 * Die aufrufende Schicht MUSS vorher die Pre-Flash-Pruefung
 * (FlashSafetyChecker) und eine Nutzerbestaetigung verlangen.
 */
class FastbootWrapper(private val context: Context) {

    private val fastbootFile = File(context.filesDir, "fastboot")
    val fastbootPath: String get() = fastbootFile.absolutePath

    private val allowedVerbs = setOf(
        "devices", "flash", "flashall", "erase", "format", "boot", "reboot",
        "reboot-bootloader", "continue", "oem", "flashing", "getvar", "fetch",
        "set_active", "stage", "get_staged"
    )

    init {
        ensureBinary()
    }

    fun ensureBinary(): Boolean {
        val (_, isReal) = FileUtils.extractAsset(context, "devicecontrol/fastboot", fastbootFile)
        return isReal
    }

    val binaryReady: Boolean get() = FileUtils.isElfBinary(fastbootFile)

    fun execute(args: List<String>, timeoutSeconds: Long = 300): ProcessUtils.Result {
        if (!binaryReady) {
            return ProcessUtils.Result(
                -1,
                "ERROR: fastboot-Binary ist ein Platzhalter.\n" +
                    "Bitte scripts/fetch-android-tools.sh ausfuehren und die App neu bauen."
            )
        }
        val verb = args.firstOrNull()?.lowercase() ?: ""
        if (verb !in allowedVerbs) {
            return ProcessUtils.Result(-1, "ERROR: fastboot-Unterbefehl '$verb' ist nicht freigegeben.")
        }
        return ProcessUtils.run(listOf(fastbootPath) + args, timeoutSeconds, context.filesDir)
    }

    fun executeCommand(command: String, timeoutSeconds: Long = 300): ProcessUtils.Result {
        val args = AdbWrapper.splitCommand(command)
        if (args.isEmpty()) return ProcessUtils.Result(-1, "ERROR: leerer Befehl")
        return execute(args, timeoutSeconds)
    }

    /** Verbundene Fastboot-Geraete. */
    fun getDevices(): List<String> =
        execute(listOf("devices"), 20).output.lines()
            .filter { it.isNotBlank() && it.contains("\t") }
            .map { it.split("\t")[0].trim() }

    /** Partition flashen (aufrufende Schicht muss Safety-Check erledigt haben). */
    fun flash(partition: String, imageFile: String): ProcessUtils.Result =
        execute(listOf("flash", partition, imageFile), 900)

    /** Bootloader entsperren – moderne Geraete (`flashing unlock`), Fallback `oem unlock`. */
    fun unlockBootloader(): ProcessUtils.Result {
        val modern = execute(listOf("flashing", "unlock"), 120)
        if (modern.exitCode != 0 && modern.output.contains("not supported", true)) {
            return execute(listOf("oem", "unlock"), 120)
        }
        return modern
    }

    fun lockBootloader(): ProcessUtils.Result {
        val modern = execute(listOf("flashing", "lock"), 120)
        if (modern.exitCode != 0 && modern.output.contains("not supported", true)) {
            return execute(listOf("oem", "lock"), 120)
        }
        return modern
    }

    /** Bootloader-Status (`unlocked: yes/no`). */
    fun getUnlockedStatus(): ProcessUtils.Result =
        execute(listOf("getvar", "unlocked"), 20)

    fun reboot(): ProcessUtils.Result = execute(listOf("reboot"), 30)
    fun rebootBootloader(): ProcessUtils.Result = execute(listOf("reboot-bootloader"), 30)

    /** Custom Recovery (z. B. TWRP/OrangeFox) flashen. */
    fun flashRecovery(imagePath: String): ProcessUtils.Result =
        flash("recovery", imagePath)

    /** GSI auf die system-Partition flashen. */
    fun flashGsi(systemImage: String): ProcessUtils.Result =
        flash("system", systemImage)
}
