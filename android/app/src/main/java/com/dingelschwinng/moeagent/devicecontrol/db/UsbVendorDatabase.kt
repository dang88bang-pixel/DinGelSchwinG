package com.dingelschwinng.moeagent.devicecontrol.db

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject

/**
 * Hersteller-Datenbank: USB-Vendor-ID (VID) -> Herstellername.
 *
 * Befuellt aus assets/devicecontrol/usb_vendors.json (Quelle: offizielle
 * USB-IF-Vendor-Liste, gefiltert auf Android-relevante Hersteller). Damit
 * zeigt die Port-View statt "0x2717" z. B. "Xiaomi" an.
 */
class UsbVendorDatabase(context: Context) :
    SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {

    private val appContext = context.applicationContext

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE vendors (
                vid INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                is_android_vendor INTEGER DEFAULT 0
            )
            """.trimIndent()
        )
        loadFromAssets(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS vendors")
        onCreate(db)
    }

    private fun loadFromAssets(db: SQLiteDatabase) {
        try {
            val json = appContext.assets.open(ASSET_NAME).bufferedReader().use { it.readText() }
            val obj = JSONObject(json)
            val vendors = obj.getJSONObject("vendors")
            db.beginTransaction()
            try {
                for (key in vendors.keys()) {
                    val entry = vendors.getJSONObject(key)
                    val stmt = db.compileStatement(
                        "INSERT OR REPLACE INTO vendors (vid, name, is_android_vendor) VALUES (?, ?, ?)"
                    )
                    stmt.bindLong(1, key.toLong())
                    stmt.bindString(2, entry.optString("name", "Unbekannt"))
                    stmt.bindLong(3, if (entry.optBoolean("android", false)) 1 else 0)
                    stmt.executeInsert()
                    stmt.close()
                }
                db.setTransactionSuccessful()
            } finally {
                db.endTransaction()
            }
        } catch (_: Exception) {
            // Ohne Asset bleibt die Tabelle leer – Port-View zeigt dann
            // "Unbekannter Hersteller (0x…)" an.
        }
    }

    /** Herstellername zu einer Vendor-ID, oder null. */
    fun getVendorName(vendorId: Int): String? {
        readableDatabase.query(
            "vendors", arrayOf("name"), "vid=?",
            arrayOf(vendorId.toString()), null, null, null
        ).use { cursor ->
            return if (cursor.moveToFirst()) cursor.getString(0) else null
        }
    }

    /** true, wenn die VID einem bekannten Android-Hersteller gehoert. */
    fun isAndroidVendor(vendorId: Int): Boolean {
        readableDatabase.query(
            "vendors", arrayOf("is_android_vendor"), "vid=?",
            arrayOf(vendorId.toString()), null, null, null
        ).use { cursor ->
            return cursor.moveToFirst() && cursor.getInt(0) == 1
        }
    }

    fun vendorCount(): Int {
        readableDatabase.rawQuery("SELECT COUNT(*) FROM vendors", null).use { c ->
            return if (c.moveToFirst()) c.getInt(0) else 0
        }
    }

    companion object {
        private const val DB_NAME = "usb_vendors.db"
        private const val DB_VERSION = 1
        private const val ASSET_NAME = "devicecontrol/usb_vendors.json"
    }
}
