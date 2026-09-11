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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * A directed edge between two graph nodes (informational; the canvas
 * currently renders nodes, details arrive via WebSocket on tap).
 */
data class GraphEdge(
    val from: String,
    val to: String,
    val type: String,
)

/**
 * Holds graph state, owns the [WebSocketClient], and implements the sequence
 * flow: node tap -> raycast hit-test -> `GET_DETAILS` -> popup with details +
 * AI summary.
 *
 * // REAL-IMPLEMENTATION 2026-09-11 (Phase 2.6):
 * Nodes come from `GET /graph` (live Neo4j overview) instead of a hardcoded
 * list; the previous demo layout stays as the explicit offline fallback.
 */
class NodeGraphViewModel : ViewModel() {

    companion object {
        /** Offline fallback: the previous demo layout (explicit, labelled). */
        private val DEMO_NODES = listOf(
            GraphNode("switch-a", "Switch A", Offset(0.5f, 0.30f)),
            GraphNode("switch-b", "Switch B", Offset(0.25f, 0.60f)),
            GraphNode("switch-c", "Switch C", Offset(0.75f, 0.60f)),
            GraphNode("vesc-1", "VESC 1", Offset(0.15f, 0.85f)),
            GraphNode("ninebot-1", "Ninebot", Offset(0.55f, 0.90f)),
        )

        private const val GRAPH_LIMIT = 50
    }

    private val http = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS)
        .build()

    /** Live node layout; starts with the demo fallback until `/graph` answers. */
    var nodes: List<GraphNode> by mutableStateOf(DEMO_NODES)
        private set

    /** Edges from `/graph` (empty while the demo fallback is active). */
    var edges: List<GraphEdge> by mutableStateOf(emptyList())
        private set

    /** Where [nodes] came from: `neo4j` (live) or `demo` (offline fallback). */
    var graphSource: String by mutableStateOf("demo")
        private set

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
        refreshGraph()
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

    /** Reload the node layout from `GET /graph` (public for pull-to-refresh). */
    fun refreshGraph() {
        viewModelScope.launch {
            val result = fetchGraph()
            if (result != null && result.nodes.isNotEmpty()) {
                nodes = result.nodes
                edges = result.edges
                graphSource = result.source
            }
            // On failure the demo fallback simply stays active (no crash, no guess).
        }
    }

    private data class GraphResult(
        val nodes: List<GraphNode>,
        val edges: List<GraphEdge>,
        val source: String,
    )

    private suspend fun fetchGraph(): GraphResult? = withContext(Dispatchers.IO) {
        try {
            val base = httpBase(BuildConfig.WS_URL)
            val request = Request.Builder()
                .url("$base/graph?limit=$GRAPH_LIMIT")
                .get()
                .build()
            http.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return@withContext null
                val body = response.body?.string() ?: return@withContext null
                parseGraph(body)
            }
        } catch (_: Exception) {
            null // offline: caller keeps the demo fallback
        }
    }

    private fun httpBase(wsUrl: String): String {
        val http = wsUrl
            .replaceFirst("wss://", "https://")
            .replaceFirst("ws://", "http://")
        return http.substringBefore("/ws").trimEnd('/')
    }

    private fun parseGraph(body: String): GraphResult? {
        return try {
            val root = JSONObject(body)
            val source = if (root.optString("source") == "neo4j") "neo4j" else "demo"
            val nodeArray = root.optJSONArray("nodes") ?: return null
            val parsedNodes = mutableListOf<GraphNode>()
            for (i in 0 until nodeArray.length()) {
                val n = nodeArray.optJSONObject(i) ?: continue
                val id = n.optString("id").ifBlank { continue }
                val label = n.optString("label").ifBlank { id }
                val x = n.optDouble("x", 0.5).toFloat().coerceIn(0.05f, 0.95f)
                val y = n.optDouble("y", 0.5).toFloat().coerceIn(0.05f, 0.95f)
                parsedNodes.add(GraphNode(id, label, Offset(x, y)))
            }
            if (parsedNodes.isEmpty()) return null
            val parsedEdges = mutableListOf<GraphEdge>()
            val edgeArray = root.optJSONArray("edges")
            if (edgeArray != null) {
                for (i in 0 until edgeArray.length()) {
                    val e = edgeArray.optJSONObject(i) ?: continue
                    parsedEdges.add(
                        GraphEdge(
                            from = e.optString("from"),
                            to = e.optString("to"),
                            type = e.optString("type"),
                        ),
                    )
                }
            }
            GraphResult(parsedNodes, parsedEdges, source)
        } catch (_: Exception) {
            null
        }
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
