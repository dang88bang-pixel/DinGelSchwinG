package com.dingelschwinng.moeagent;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * Capacitor-Host der App.
 *
 * Einziger eigener Baustein: der PortView-Plugin. Er läuft nativ (UDP-Broadcast +
 * HTTP-Probe) und liefert der Web-Schicht Host und Port des Mobile-Servers, damit
 * niemand in der Halle IPs eintippen muss – die WebView selbst dürfte beides nicht.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PortViewPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
