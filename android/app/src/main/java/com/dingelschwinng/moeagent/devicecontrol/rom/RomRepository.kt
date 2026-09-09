package com.dingelschwinng.moeagent.devicecontrol.rom

import android.content.Context
import com.dingelschwinng.moeagent.devicecontrol.models.DeviceProfile
import com.dingelschwinng.moeagent.devicecontrol.models.RomInfo
import org.json.JSONObject

/**
 * Liest die Geraete-/ROM-Datenbanken aus den Assets:
 *
 *  - devicecontrol/supported_devices.json : Marke -> Modelle, Fastboot-Support,
 *    Partitionsnamen je Marke (Datenbasis der "ChimeraTool-artigen" Modellliste)
 *  - devicecontrol/rom_database.json      : verfuegbare Custom-ROMs +
 *    Geraeteprofile (Codename, Flash-Methode, Partitionen, Unlock-Pflicht)
 *
 * Die Listen sind reine Daten – erweitern heisst: JSON editieren, neu bauen.
 */
class RomRepository(private val context: Context) {

    private val supportedDevicesJson: JSONObject by lazy { loadAsset("devicecontrol/supported_devices.json") }
    private val romDatabaseJson: JSONObject by lazy { loadAsset("devicecontrol/rom_database.json") }

    private fun loadAsset(name: String): JSONObject = try {
        JSONObject(context.assets.open(name).bufferedReader().use { it.readText() })
    } catch (_: Exception) {
        JSONObject()
    }

    /** Alle Marken aus der Unterstuetzungsliste. */
    fun brands(): List<String> {
        val arr = supportedDevicesJson.optJSONArray("supported_brands") ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }
    }

    /** Modelle einer Marke. */
    fun models(brand: String): List<String> {
        val models = supportedDevicesJson.optJSONObject("supported_models") ?: return emptyList()
        val arr = models.optJSONArray(brand) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }
    }

    /** Anzahl aller Modelle ueber alle Marken. */
    fun totalModelCount(): Int = brands().sum { models(it).size }

    fun hasFastbootSupport(brand: String): Boolean =
        supportedDevicesJson.optJSONObject("fastboot_support")?.optBoolean(brand, false) ?: false

    /** Partitionsnamen fuer eine Marke (z. B. boot/recovery/system). */
    fun flashCommands(brand: String): Map<String, String> {
        val obj = supportedDevicesJson.optJSONObject("flash_commands")
            ?.optJSONObject(brand) ?: return emptyMap()
        val out = mutableMapOf<String, String>()
        for (key in obj.keys()) out[key] = obj.optString(key)
        return out
    }

    /** Alle Custom-ROMs aus der ROM-Datenbank. */
    fun roms(): List<RomInfo> {
        val arr = romDatabaseJson.optJSONArray("roms") ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            val o = arr.optJSONObject(i) ?: return@mapNotNull null
            val devices = o.optJSONArray("supported_devices")
            RomInfo(
                id = o.optString("id"),
                name = o.optString("name"),
                description = o.optString("description"),
                website = o.optString("website"),
                supportedDevices = if (devices == null) emptyList()
                else (0 until devices.length()).map { devices.optString(it) }
            )
        }
    }

    /** Geraeteprofile (Codename, Flash-Methode, Partitionen, …). */
    fun deviceProfiles(): Map<String, DeviceProfile> {
        val devices = romDatabaseJson.optJSONObject("devices") ?: return emptyMap()
        val out = mutableMapOf<String, DeviceProfile>()
        for (id in devices.keys()) {
            val o = devices.optJSONObject(id) ?: continue
            val roms = o.optJSONArray("supported_roms")
            val parts = o.optJSONArray("partitions")
            out[id] = DeviceProfile(
                id = id,
                model = o.optString("model"),
                codename = o.optString("codename"),
                brand = o.optString("brand"),
                supportedRoms = if (roms == null) emptyList() else (0 until roms.length()).map { roms.optString(it) },
                flashMethod = o.optString("flash_method", "fastboot"),
                partitions = if (parts == null) emptyList() else (0 until parts.length()).map { parts.optString(it) },
                unlockRequired = o.optBoolean("unlock_required", true),
                arbWarning = o.optString("arb_warning", "")
            )
        }
        return out
    }

    /** Profil passend zu einer Modellbezeichnung (unscharfe Suche). */
    fun findProfile(modelString: String): DeviceProfile? {
        val needle = modelString.lowercase().replace(" ", "")
        return deviceProfiles().values.firstOrNull {
            it.model.lowercase().replace(" ", "") == needle ||
                it.codename.lowercase() == needle
        } ?: deviceProfiles().values.firstOrNull {
            needle.contains(it.model.lowercase().replace(" ", ""))
        }
    }
}
