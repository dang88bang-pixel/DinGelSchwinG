package com.dingelschwinng.moeagent.devicecontrol.db

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * Geraete-Historie und gespeicherte Geraete.
 *
 *  - device_history: chronologische Übersicht aller je gesehenen Geraete
 *  - saved_devices:  vom Nutzer benannte/favorisierte Geraete
 *  - flash_history:  Protokoll aller Flash-Vorgaenge (Brick-Nachverfolgung)
 */
class DeviceHistoryDb(context: Context) :
    SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE device_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                serial TEXT NOT NULL,
                model TEXT,
                manufacturer TEXT,
                vid TEXT,
                pid TEXT,
                first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                connection_count INTEGER DEFAULT 1,
                last_state TEXT
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX idx_history_serial ON device_history(serial)")

        db.execSQL(
            """
            CREATE TABLE saved_devices (
                serial TEXT PRIMARY KEY,
                model TEXT,
                manufacturer TEXT,
                alias TEXT,
                is_favorite INTEGER DEFAULT 0,
                last_connected TIMESTAMP
            )
            """.trimIndent()
        )

        db.execSQL(
            """
            CREATE TABLE flash_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_serial TEXT NOT NULL,
                rom_name TEXT NOT NULL,
                flash_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                success INTEGER DEFAULT 0,
                error_message TEXT,
                backup_created INTEGER DEFAULT 0
            )
            """.trimIndent()
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Schema v1 – keine Migration noetig
    }

    /** Geraet gesehen: Historie anlegen oder zaehlen. */
    fun touchDevice(serial: String, model: String?, manufacturer: String?, vid: String?, pid: String?, state: String) {
        val db = writableDatabase
        db.rawQuery("SELECT id, connection_count FROM device_history WHERE serial=?", arrayOf(serial)).use { c ->
            if (c.moveToFirst()) {
                val values = ContentValues().apply {
                    put("last_seen", System.currentTimeMillis())
                    put("connection_count", c.getInt(1) + 1)
                    put("last_state", state)
                    model?.let { put("model", it) }
                }
                db.update("device_history", values, "id=?", arrayOf(c.getInt(0).toString()))
            } else {
                val values = ContentValues().apply {
                    put("serial", serial)
                    put("model", model)
                    put("manufacturer", manufacturer)
                    put("vid", vid)
                    put("pid", pid)
                    put("last_state", state)
                }
                db.insert("device_history", null, values)
            }
        }
    }

    fun setAlias(serial: String, alias: String) {
        val values = ContentValues().apply {
            put("serial", serial)
            put("alias", alias)
            put("last_connected", System.currentTimeMillis())
        }
        writableDatabase.insertWithOnConflict("saved_devices", null, values, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun logFlash(serial: String, romName: String, success: Boolean, error: String?, backupCreated: Boolean) {
        val values = ContentValues().apply {
            put("device_serial", serial)
            put("rom_name", romName)
            put("success", if (success) 1 else 0)
            put("error_message", error)
            put("backup_created", if (backupCreated) 1 else 0)
        }
        writableDatabase.insert("flash_history", null, values)
    }

    /** Letzte Eintraege der Historie (neueste zuerst). */
    fun recentDevices(limit: Int = 20): List<Map<String, String>> {
        val out = mutableListOf<Map<String, String>>()
        readableDatabase.rawQuery(
            "SELECT serial, model, manufacturer, last_state, connection_count, last_seen " +
                "FROM device_history ORDER BY last_seen DESC LIMIT ?",
            arrayOf(limit.toString())
        ).use { c ->
            while (c.moveToNext()) {
                out.add(
                    mapOf(
                        "serial" to c.getString(0),
                        "model" to (c.getString(1) ?: ""),
                        "manufacturer" to (c.getString(2) ?: ""),
                        "state" to (c.getString(3) ?: ""),
                        "count" to c.getInt(4).toString(),
                        "lastSeen" to c.getLong(5).toString()
                    )
                )
            }
        }
        return out
    }

    companion object {
        private const val DB_NAME = "device_history.db"
        private const val DB_VERSION = 1
    }
}
