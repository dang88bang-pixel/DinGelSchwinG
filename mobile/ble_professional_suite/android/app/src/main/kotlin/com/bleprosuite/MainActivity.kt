package com.bleprosuite

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * MainActivity der BLE Professional Suite.
 *
 * Stellt einen kleinen MethodChannel-Helfer bereit (OS-SDK-Version),
 * den PermissionHelper für die Android-12-Berechtigungslogik nutzt.
 */
class MainActivity : FlutterActivity() {

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            "ble_professional_suite/os",
        ).setMethodCallHandler { call, result ->
            when (call.method) {
                "sdkInt" -> result.success(android.os.Build.VERSION.SDK_INT)
                else -> result.notImplemented()
            }
        }
    }
}
