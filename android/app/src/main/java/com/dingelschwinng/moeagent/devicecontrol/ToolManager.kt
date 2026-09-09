package com.dingelschwinng.moeagent.devicecontrol

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri

/**
 * Verwaltung der externen Zusatz-Tools:
 *
 *  - ADBify   (com.justunes.adbify)    – erweiterte ADB-Aktionen
 *  - Bugjaeger (eu.hackenberger.bugjaeger) – USB-OTG-Debugging, Screenshots,
 *    Logcat-Viewer, App-Installation direkt auf dem Zielgeraet
 *
 * Beide werden NICHT kopiert oder dekompiliert; die Integration laeuft
 * ausschliesslich ueber Paket-Erkennung und Intents (Play Store / App-Start).
 */
class ToolManager(private val context: Context) {

    data class ToolStatus(val name: String, val packageName: String, val installed: Boolean)

    fun checkAdbify(): Boolean = isPackageInstalled(PKG_ADBIFY)
    fun checkBugjaeger(): Boolean = isPackageInstalled(PKG_BUGJAEGER)

    /** ChimeraTool hat keine oeffentliche Android-App; geprueft wird dennoch,
     *  damit die UI einen einheitlichen Status anzeigen kann. */
    fun checkChimera(): Boolean = isPackageInstalled(PKG_CHIMERA)

    fun allStatus(): List<ToolStatus> = listOf(
        ToolStatus("ADBify", PKG_ADBIFY, checkAdbify()),
        ToolStatus("Bugjaeger", PKG_BUGJAEGER, checkBugjaeger()),
        ToolStatus("ChimeraTool", PKG_CHIMERA, checkChimera())
    )

    fun isPackageInstalled(packageName: String): Boolean = try {
        context.packageManager.getPackageInfo(packageName, 0)
        true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

    /** Oeffnet Play Store (Fallback: Browser), damit der Nutzer Tools nachinstallieren kann. */
    fun openPlayStore(packageName: String): Boolean {
        val market = Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(market)
            true
        } catch (_: Exception) {
            try {
                val web = Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("https://play.google.com/store/apps/details?id=$packageName")
                ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(web)
                true
            } catch (_: Exception) { false }
        }
    }

    /**
     * Startet Bugjaeger mit einem vordefinierten Zielgeraet. Bugjaeger
     * unterstuetzt einen Deep-Link ueber das Paket-Intent; falls kein
     * dokumentierter Extra existiert, wird die App einfach geoeffnet.
     */
    fun launchBugjaeger(targetSerial: String? = null): Boolean {
        val launch = context.packageManager.getLaunchIntentForPackage(PKG_BUGJAEGER) ?: return false
        if (targetSerial != null) launch.putExtra("eu.hackenberger.bugjaeger.extra.SERIAL", targetSerial)
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try { context.startActivity(launch); true } catch (_: Exception) { false }
    }

    fun launchAdbify(): Boolean {
        val launch = context.packageManager.getLaunchIntentForPackage(PKG_ADBIFY) ?: return false
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try { context.startActivity(launch); true } catch (_: Exception) { false }
    }

    companion object {
        const val PKG_ADBIFY = "com.justunes.adbify"
        const val PKG_BUGJAEGER = "eu.hackenberger.bugjaeger"
        const val PKG_CHIMERA = "com.chimeratool.app"
    }
}
