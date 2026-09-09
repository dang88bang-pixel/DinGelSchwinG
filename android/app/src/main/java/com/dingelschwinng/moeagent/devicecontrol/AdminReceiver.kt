package com.dingelschwinng.moeagent.devicecontrol

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast

/**
 * Device-Admin-Empfaenger fuer den CT45P-Flottenbetrieb.
 *
 * Die Rolle ist bewusst eng: Das Steuergeraet selbst kann damit aus der
 * Ferne gesperrt oder zurueckgesetzt werden. Der Admin muss vom Nutzer in
 * den Systemeinstellungen explizit aktiviert werden; die App erzwingt
 * nichts. (Keine Passwort-Policies – die App verwaltet keine fremden
 * Nutzerkonten.)
 */
class AdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        super.onEnabled(context, intent)
        Toast.makeText(context, "Admin-Rechte aktiviert", Toast.LENGTH_SHORT).show()
    }

    override fun onDisabled(context: Context, intent: Intent) {
        super.onDisabled(context, intent)
        Toast.makeText(context, "Admin-Rechte deaktiviert", Toast.LENGTH_SHORT).show()
    }
}
