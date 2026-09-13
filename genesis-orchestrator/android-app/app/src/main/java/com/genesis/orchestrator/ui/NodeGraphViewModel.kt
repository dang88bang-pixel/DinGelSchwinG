package com.genesis.orchestrator.ui

import android.app.Application
import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.lifecycle.AndroidViewModel
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
import org.json.JSONArray
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
 * // REAL-IMPLEMENTATION 2026-09-13 (Schritt 3): Der festcodierte Demo-Graph
 * (`DEMO_NODES`) ist entfernt. Knoten kommen ausschließlich aus echten Quellen:
 * live aus `GET /graph` (Neo4j) oder — wenn das Backend nicht erreichbar ist —
 * aus dem **zuletzt erfolgreich geladenen** Graphen (persistenter Cache in
 * [PREF_FILE]). Ist beides leer, bleibt die Zeichenfläche leer und [graphSource]
 * sagt ehrlich `offline`; es werden keine Knoten erfunden.
 */
class NodeGraphViewModel(app: Application) : AndroidViewModel(app) {

    private companion object {
        const val GRAPH_LIMIT = 50
        const val PREF_FILE = "dgs_genesis_graph"
        const val PREF_KEY = "last_graph"
        /** Quellen-Kennzeichnung für die UI. */
        const val SOURCE_LIVE = "neo4j"
        const val SOURCE_CACHE = "cache"
        const val SOURCE_OFFLINE = "offline"
    }

    private val http = OkHttpClient.Builder()
        .connectTimeout(4, TimeUnit.SECONDS)
        .readTimeout(6, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS)
        .build()

    private val prefs = app.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE)

    private val cached: GraphResult? = loadCache()

    /** Node layout: live from Neo4j or the last successfully loaded graph. */
    var nodes: List<GraphNode> by mutableStateOf(cached?.nodes ?: emptyList())
        private set

    /** Edges belonging to [nodes] (from `/graph` or the cache). */
    var edges: List<GraphEdge> by mutableStateOf(cached?.edges ?: emptyList())
        private set

    /** Where [nodes] came from: `neo4j` (live), `cache` (last live load) or `offline`. */
    var graphSource: String by mutableStateOf(
        if (cached != null) SOURCE_CACHE else SOURCE_OFFLINE,
    )
        private set

    /** Reason why no live graph is shown (null while live data is present). */
    var graphNote: String? by mutableStateOf(
        if (cached != null) "Offline – letzter geladener Graph" else null,
    )
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

    /**
     * Reload the node layout from `GET /graph` (public for pull-to-refresh).
     *
     * Erfolg -> live anzeigen **und** als Cache ablegen.
     * Fehler  -> letzter geladener Graph bleibt sichtbar (Quelle `cache`);
     *           ohne Cache leer + ehrlicher Hinweis (Quelle `offline`).
     */
    fun refreshGraph() {
        viewModelScope.launch {
            val result = fetchGraph()
            if (result != null && result.nodes.isNotEmpty()) {
                nodes = result.nodes
                edges = result.edges
                graphSource = result.source
                graphNote = null
                saveCache(result)
            } else {
                val fallback = loadCache()
                if (fallback != null) {
                    nodes = fallback.nodes
                    edges = fallback.edges
                    graphSource = SOURCE_CACHE
                    graphNote = "Backend offline – letzter geladener Graph"
                } else {
                    nodes = emptyList()
                    edges = emptyList()
                    graphSource = SOURCE_OFFLINE
                    graphNote = "Backend offline und kein Graph im Cache – keine Knoten zum Anzeigen"
                }
            }
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
            null // offline: caller falls back to the cache / empty state
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
            // Jede erfolgreiche /graph-Antwort ist Live-Daten (Neo4j-Übersicht).
            val source = SOURCE_LIVE
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

    /** Persistiert den zuletzt erfolgreich geladenen Graphen (echte Daten). */
    private fun saveCache(result: GraphResult) {
        try {
            val root = JSONObject()
            val nodeArray = JSONArray()
            for (n in result.nodes) {
                nodeArray.put(
                    JSONObject()
                        .put("id", n.id)
                        .put("label", n.label)
                        .put("x", n.position.x.toDouble())
                        .put("y", n.position.y.toDouble()),
                )
            }
            val edgeArray = JSONArray()
            for (e in result.edges) {
                edgeArray.put(JSONObject().put("from", e.from).put("to", e.to).put("type", e.type))
            }
            root.put("saved_at", System.currentTimeMillis())
            root.put("nodes", nodeArray)
            root.put("edges", edgeArray)
            prefs.edit().putString(PREF_KEY, root.toString()).apply()
        } catch (_: Exception) {
            // Cache ist Komfort, kein Muss – Fehler hier dürfen die UI nie stören.
        }
    }

    private fun loadCache(): GraphResult? {
        val raw = prefs.getString(PREF_KEY, null) ?: return null
        return try {
            val root = JSONObject(raw)
            val nodeArray = root.optJSONArray("nodes") ?: return null
            val parsedNodes = mutableListOf<GraphNode>()
            for (i in 0 until nodeArray.length()) {
                val n = nodeArray.optJSONObject(i) ?: continue
                val id = n.optString("id").ifBlank { continue }
                parsedNodes.add(
                    GraphNode(
                        id = id,
                        label = n.optString("label").ifBlank { id },
                        position = Offset(
                            n.optDouble("x", 0.5).toFloat(),
                            n.optDouble("y", 0.5).toFloat(),
                        ),
                    ),
                )
            }
            if (parsedNodes.isEmpty()) return null
            val parsedEdges = mutableListOf<GraphEdge>()
            val edgeArray = root.optJSONArray("edges")
            if (edgeArray != null) {
                for (i in 0 until edgeArray.length()) {
                    val e = edgeArray.optJSONObject(i) ?: continue
                    parsedEdges.add(GraphEdge(e.optString("from"), e.optString("to"), e.optString("type")))
                }
            }
            GraphResult(parsedNodes, parsedEdges, SOURCE_CACHE)
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
