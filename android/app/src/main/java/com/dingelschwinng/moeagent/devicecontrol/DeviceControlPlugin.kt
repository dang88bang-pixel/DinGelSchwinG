package com.dingelschwinng.moeagent.devicecontrol

import android.content.Intent
import com.dingelschwinng.moeagent.devicecontrol.flash.BackupManager
import com.dingelschwinng.moeagent.devicecontrol.flash.BrickProtectionManager
import com.dingelschwinng.moeagent.devicecontrol.flash.FlashSafetyChecker
import com.dingelschwinng.moeagent.devicecontrol.flash.FlashSetupWizard
import com.dingelschwinng.moeagent.devicecontrol.rom.RomRepository
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * Capacitor-Bruecke des Device-Control-Subsystems.
 *
 * Damit kann die Web-Schicht (React/Agent-Console) dieselben Funktionen
 * nutzen wie die native Steuerkonsole:
 *
 *   DeviceControl.status()          – Binary-Status, Datenbank-Umfang
 *   DeviceControl.portView()        – USB + ADB vereinigt (automatische Port-View)
 *   DeviceControl.adbDevices()      – nur ADB
 *   DeviceControl.runAdb({command, serial})
 *   DeviceControl.runFastboot({command})
 *   DeviceControl.parseCommand({input, serial})   – Sprach-Kommandos (DE/EN)
 *   DeviceControl.deviceInfo({serial})
 *   DeviceControl.toolStatus() / openPlayStore({package}) / launchTool({tool})
 *   DeviceControl.romList() / deviceProfiles()
 *   DeviceControl.arbReport({serial})
 *   DeviceControl.preFlashCheck({serial, profileId, romPath, sha256, targetArb})
 *   DeviceControl.wizardSteps() / wizardPrepare({serial}) /
 *   DeviceControl.wizardUnlock({serial, confirmed}) / wizardFinish({serial})
 *   DeviceControl.backupChecklist()
 *   DeviceControl.openConsole({serial})  – oeffnet die native Konsole
 *
 * Alle Methoden, die Prozesse starten, laufen in einem Hintergrund-Thread.
 */
@CapacitorPlugin(name = "DeviceControl")
class DeviceControlPlugin : Plugin() {

    private val adb by lazy { AdbWrapper(context) }
    private val fastboot by lazy { FastbootWrapper(context) }
    private val toolManager by lazy { ToolManager(context) }
    private val romRepo by lazy { RomRepository(context) }
    private val deviceManager by lazy { DeviceManager(context) }

    @PluginMethod
    fun status(call: PluginCall) {
        background(call) {
            val ret = JSObject()
            ret.put("adbReady", adb.binaryReady)
            ret.put("fastbootReady", fastboot.binaryReady)
            ret.put("vendorDbSize", deviceManager.vendorCount())
            ret.put("supportedModelCount", romRepo.totalModelCount())
            ret.put("brands", jsArrayOf(romRepo.brands()))
            ret
        }
    }

    @PluginMethod
    fun portView(call: PluginCall) {
        background(call) {
            val entries = deviceManager.refresh()
            val arr = JSArray()
            entries.forEach { e ->
                arr.put(
                    JSObject()
                        .put("label", e.label)
                        .put("serial", e.serial)
                        .put("vendor", e.vendor)
                        .put("vid", e.vid)
                        .put("pid", e.pid)
                        .put("state", e.state)
                        .put("type", e.type.name)
                        .put("detail", e.detail)
                )
            }
            JSObject().put("devices", arr)
        }
    }

    @PluginMethod
    fun adbDevices(call: PluginCall) {
        background(call) {
            val arr = JSArray()
            adb.getDevices().forEach { d ->
                arr.put(
                    JSObject()
                        .put("serial", d.serial)
                        .put("state", d.state.raw)
                        .put("connected", d.connected)
                        .put("type", d.type.name)
                )
            }
            JSObject().put("devices", arr)
        }
    }

    @PluginMethod
    fun runAdb(call: PluginCall) {
        val command = call.getString("command")
        if (command.isNullOrBlank()) { call.reject("command fehlt"); return }
        val serial = call.getString("serial")
        background(call) {
            val result = adb.executeCommand(command, serial)
            JSObject().put("exitCode", result.exitCode).put("output", result.output)
        }
    }

    @PluginMethod
    fun runFastboot(call: PluginCall) {
        val command = call.getString("command")
        if (command.isNullOrBlank()) { call.reject("command fehlt"); return }
        background(call) {
            val result = fastboot.executeCommand(command)
            JSObject().put("exitCode", result.exitCode).put("output", result.output)
        }
    }

    @PluginMethod
    fun parseCommand(call: PluginCall) {
        val input = call.getString("input")
        if (input.isNullOrBlank()) { call.reject("input fehlt"); return }
        val serial = call.getString("serial")
        background(call) {
            val parser = CommandParser(context)
            JSObject().put("reply", parser.parseAndExecute(input, serial))
        }
    }

    @PluginMethod
    fun deviceInfo(call: PluginCall) {
        val serial = call.getString("serial")
        background(call) {
            JSObject().put("info", deviceManager.deviceInfo(serial ?: ""))
        }
    }

    @PluginMethod
    fun toolStatus(call: PluginCall) {
        val arr = JSArray()
        toolManager.allStatus().forEach {
            arr.put(JSObject().put("name", it.name).put("package", it.packageName).put("installed", it.installed))
        }
        call.resolve(JSObject().put("tools", arr))
    }

    @PluginMethod
    fun openPlayStore(call: PluginCall) {
        val pkg = call.getString("package") ?: ToolManager.PKG_BUGJAEGER
        val ok = toolManager.openPlayStore(pkg)
        call.resolve(JSObject().put("opened", ok))
    }

    @PluginMethod
    fun launchTool(call: PluginCall) {
        when (call.getString("tool")) {
            "bugjaeger" -> call.resolve(JSObject().put("launched", toolManager.launchBugjaeger(call.getString("serial"))))
            "adbify" -> call.resolve(JSObject().put("launched", toolManager.launchAdbify()))
            else -> call.reject("unbekanntes Tool (bugjaeger|adbify)")
        }
    }

    @PluginMethod
    fun romList(call: PluginCall) {
        val arr = JSArray()
        romRepo.roms().forEach { rom ->
            arr.put(
                JSObject()
                    .put("id", rom.id)
                    .put("name", rom.name)
                    .put("description", rom.description)
                    .put("website", rom.website)
                    .put("deviceCount", rom.supportedDevices.size)
            )
        }
        call.resolve(JSObject().put("roms", arr))
    }

    @PluginMethod
    fun deviceProfiles(call: PluginCall) {
        val arr = JSArray()
        romRepo.deviceProfiles().values.forEach { p ->
            arr.put(
                JSObject()
                    .put("id", p.id)
                    .put("model", p.model)
                    .put("codename", p.codename)
                    .put("brand", p.brand)
                    .put("flashMethod", p.flashMethod)
                    .put("unlockRequired", p.unlockRequired)
                    .put("partitions", jsArrayOf(p.partitions))
                    .put("roms", jsArrayOf(p.supportedRoms))
            )
        }
        call.resolve(JSObject().put("profiles", arr))
    }

    @PluginMethod
    fun arbReport(call: PluginCall) {
        val serial = call.getString("serial")
        background(call) {
            JSObject().put("report", BrickProtectionManager(context).report(serial))
        }
    }

    @PluginMethod
    fun preFlashCheck(call: PluginCall) {
        val serial = call.getString("serial")
        val profileId = call.getString("profileId")
        val romPath = call.getString("romPath")
        val sha256 = call.getString("sha256")
        val targetArb = call.getString("targetArb") ?: ""
        background(call) {
            val profile = profileId?.let { romRepo.deviceProfiles()[it] }
            val report = FlashSafetyChecker(context).preFlashCheck(
                serial, profile, romPath?.let(::File), sha256, targetArb
            )
            JSObject()
                .put("safe", report.isSafe())
                .put("summary", report.summary())
                .put("errors", jsArrayOf(report.errors))
                .put("warnings", jsArrayOf(report.warnings))
        }
    }

    @PluginMethod
    fun wizardSteps(call: PluginCall) {
        val arr = JSArray()
        FlashSetupWizard(context, null).steps().forEach { s ->
            arr.put(
                JSObject()
                    .put("id", s.id)
                    .put("title", s.title)
                    .put("description", s.description)
                    .put("warning", s.warning)
            )
        }
        call.resolve(JSObject().put("steps", arr))
    }

    @PluginMethod
    fun wizardPrepare(call: PluginCall) {
        val serial = call.getString("serial")
        background(call) {
            JSObject().put("output", FlashSetupWizard(context, serial).prepare())
        }
    }

    @PluginMethod
    fun wizardUnlock(call: PluginCall) {
        val serial = call.getString("serial")
        val confirmed = call.getBoolean("confirmed", false)
        background(call) {
            val result = FlashSetupWizard(context, serial).unlock(confirmed)
            JSObject()
                .put("success", result.success)
                .put("log", jsArrayOf(result.log))
        }
    }

    @PluginMethod
    fun wizardFinish(call: PluginCall) {
        val serial = call.getString("serial")
        background(call) {
            val result = FlashSetupWizard(context, serial).finish()
            JSObject().put("success", result.success).put("log", jsArrayOf(result.log))
        }
    }

    @PluginMethod
    fun backupChecklist(call: PluginCall) {
        val arr = JSArray()
        BackupManager(context).backupChecklist().forEach { arr.put(it) }
        call.resolve(JSObject().put("checklist", arr))
    }

    @PluginMethod
    fun openConsole(call: PluginCall) {
        val intent = Intent(context, DeviceControlActivity::class.java)
        call.getString("serial")?.let { intent.putExtra("DEVICE_SERIAL", it) }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        call.resolve()
    }

    /** JSArray aus einer String-Liste bauen (ohne JSONArray-Array-Konstruktor). */
    private fun jsArrayOf(items: List<String>): JSArray {
        val arr = JSArray()
        items.forEach { arr.put(it) }
        return arr
    }

    /** Fuehrt [block] im Hintergrund aus und resolved den Call mit dem Ergebnis. */
    private fun background(call: PluginCall, block: () -> JSObject) {
        Thread {
            try {
                val ret = block()
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject("Fehler: ${e.message}")
            }
        }.start()
    }
}
