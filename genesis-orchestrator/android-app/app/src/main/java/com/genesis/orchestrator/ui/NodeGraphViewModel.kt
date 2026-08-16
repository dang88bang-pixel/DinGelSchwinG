package com.genesis.orchestrator.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.genesis.orchestrator.BuildConfig
import com.genesis.orchestrator.proto.Action
import com.genesis.orchestrator.proto.ClientRequest
import com.genesis.orchestrator.proto.ServerResponse
import com.genesis.orchestrator.websocket.WebSocketClient
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Holds graph state, owns the [WebSocketClient], and implements the sequence
 * flow: node tap -> raycast hit-test -> `GET_DETAILS` -> popup with details +
 * AI summary.
 */
class NodeGraphViewModel : ViewModel() {

    /** Demo node layout; in production this is driven by a Neo4j graph sync. */
    val nodes: List<GraphNode> = listOf(
        GraphNode("switch-a", "Switch A", Offset(0.5f, 0.30f)),
        GraphNode("switch-b", "Switch B", Offset(0.25f, 0.60f)),
        GraphNode("switch-c", "Switch C", Offset(0.75f, 0.60f)),
        GraphNode("vesc-1", "VESC 1", Offset(0.15f, 0.85f)),
        GraphNode("ninebot-1", "Ninebot", Offset(0.55f, 0.90f)),
    )

    private val ws = WebSocketClient(BuildConfig.WS_URL)

    var connected by mutableStateOf(false)
        private set

    var selectedNode: GraphNode? by mutableStateOf(null)
        private set

    var loading by mutableStateOf(false)
        private set

    var details: com.genesis.orchestrator.proto.NodeDetails? by mutableStateOf(null)
        private set

    var relationships: List<com.genesis.orchestrator.proto.Relationship> by mutableStateOf(emptyList())
        private set

    var aiSummary: String? by mutableStateOf(null)
        private set

    var error: String? by mutableStateOf(null)
        private set

    init {
        ws.onConnectionStateChanged = { connected = it }
        ws.addListener(::onResponse)
        ws.connect()
    }

    /** Called from the Compose canvas after a successful raycast hit-test. */
    fun onNodeTapped(node: GraphNode) {
        selectedNode = node
        details = null
        relationships = emptyList()
        aiSummary = null
        error = null
        loading = true

        val request = ClientRequest.newBuilder()
            .setRequestId(UUID.randomUUID().toString())
            .setNodeId(node.id)
            .setAction(Action.GET_DETAILS)
            .build()

        if (!ws.send(request)) {
            loading = false
            error = "Backend nicht erreichbar"
        }
    }

    fun dismissPopup() {
        selectedNode = null
        details = null
        aiSummary = null
        error = null
    }

    private fun onResponse(response: ServerResponse) {
        viewModelScope.launch {
            loading = false
            if (response.status == ServerResponse.Status.OK) {
                details = response.details
                relationships = response.relationshipsList
                aiSummary = response.aiSummary
            } else {
                error = response.error.ifBlank { "Unbekannter Fehler" }
            }
        }
    }

    override fun onCleared() {
        ws.disconnect()
    }
}
