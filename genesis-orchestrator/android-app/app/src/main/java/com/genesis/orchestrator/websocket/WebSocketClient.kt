package com.genesis.orchestrator.websocket

import android.util.Log
import com.genesis.orchestrator.proto.ClientRequest
import com.genesis.orchestrator.proto.ServerResponse
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.util.concurrent.TimeUnit

/**
 * Async protobuf WebSocket client.
 *
 * Serialises [ClientRequest] messages to binary protobuf frames and delivers
 * deserialised [ServerResponse] messages to registered listeners on the main
 * (OkHttp) thread — listeners should marshal work to their own dispatcher.
 */
class WebSocketClient(
    private val url: String,
) {
    companion object {
        private const val TAG = "WebSocketClient"
    }

    private val client: OkHttpClient = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS)
        .build()

    private var socket: WebSocket? = null
    private val listeners = mutableListOf<(ServerResponse) -> Unit>()

    @Volatile
    var isConnected: Boolean = false
        private set

    /** Callback invoked when the connection state changes (connected/disconnected). */
    var onConnectionStateChanged: ((Boolean) -> Unit)? = null

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            Log.i(TAG, "Connected to $url")
            isConnected = true
            onConnectionStateChanged?.invoke(true)
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            val resp = try {
                ServerResponse.parseFrom(bytes.toByteArray())
            } catch (e: Exception) {
                Log.e(TAG, "Failed to parse response", e)
                return
            }
            listeners.forEach { it(resp) }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            Log.i(TAG, "Closed ($code): $reason")
            isConnected = false
            onConnectionStateChanged?.invoke(false)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.e(TAG, "Connection failure", t)
            isConnected = false
            onConnectionStateChanged?.invoke(false)
        }
    }

    fun connect() {
        if (socket != null) return
        val request = Request.Builder().url(url).build()
        socket = client.newWebSocket(request, listener)
    }

    fun disconnect() {
        socket?.close(1000, "client shutdown")
        socket = null
    }

    /** Register a listener for incoming [ServerResponse] frames. */
    fun addListener(listener: (ServerResponse) -> Unit) {
        listeners.add(listener)
    }

    fun removeListener(listener: (ServerResponse) -> Unit) {
        listeners.remove(listener)
    }

    /** Serialise and transmit a [ClientRequest] as a binary protobuf frame. */
    fun send(request: ClientRequest): Boolean {
        val current = socket ?: return false
        return current.send(ByteString.of(*request.toByteArray()))
    }
}
