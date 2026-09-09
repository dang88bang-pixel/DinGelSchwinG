package com.dingelschwinng.moeagent;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import com.dingelschwinng.moeagent.devicecontrol.DeviceControlPlugin;

/**
 * Capacitor-Host der App.
 *
 * Eigene Bausteine:
 *  - PortViewPlugin: UDP-Broadcast + HTTP-Probe, liefert Host/Port des
 *    Mobile-Servers (die WebView darf beides nicht selbst).
 *  - DeviceControlPlugin: ADB/Fastboot-Engine, automatische Port-View,
 *    ROM-Datenbank und Brick-Schutz des Device-Control-Subsystems
 *    (siehe docs/device-control.md).
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PortViewPlugin.class);
        registerPlugin(DeviceControlPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
