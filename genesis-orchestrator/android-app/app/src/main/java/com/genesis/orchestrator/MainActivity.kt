package com.genesis.orchestrator

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import com.genesis.orchestrator.ui.MainScreen
import com.genesis.orchestrator.ui.theme.GenesisOrchestratorTheme

/**
 * Entry point of the Honeywell CT45 XP client.
 *
 * Hosts the top-level [MainScreen], which switches between the interactive
 * node graph (raycasting hit-test + protobuf `GET_DETAILS` flow) and the
 * Polar BLE configuration surface.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            GenesisOrchestratorTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    MainScreen()
                }
            }
        }
    }
}
