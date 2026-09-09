package com.dingelschwinng.moeagent.devicecontrol

import android.graphics.Color
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.dingelschwinng.moeagent.R
import com.dingelschwinng.moeagent.devicecontrol.models.ChatMessage
import com.dingelschwinng.moeagent.devicecontrol.models.PortEntry

/**
 * Native Steuerkonsole des Device-Control-Subsystems.
 *
 * Obere Haelfte: automatische Port-View (USB-Host + ADB, live per
 * BroadcastReceiver). Untere Haelfte: Chat mit dem CommandParser
 * („geräte“, „install …“, „hilfe“, …).
 */
class DeviceControlActivity : AppCompatActivity() {

    private lateinit var deviceManager: DeviceManager
    private lateinit var parser: CommandParser
    private var targetDevice: String? = null

    private val deviceAdapter = DeviceRowAdapter { entry -> onDeviceClicked(entry) }
    private val chatAdapter = ChatMessageAdapter()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_device_control)

        deviceManager = DeviceManager(applicationContext)
        parser = CommandParser(applicationContext)

        // Port-View
        val deviceList = findViewById<RecyclerView>(R.id.deviceRecyclerView)
        deviceList.layoutManager = LinearLayoutManager(this)
        deviceList.adapter = deviceAdapter
        deviceManager.entries.observe(this) { entries ->
            deviceAdapter.submit(entries)
        }

        // Chat
        val chatList = findViewById<RecyclerView>(R.id.chatRecyclerView)
        chatList.layoutManager = LinearLayoutManager(this)
        chatList.adapter = chatAdapter

        targetDevice = intent.getStringExtra("DEVICE_SERIAL")
        addMessage(
            "System",
            if (targetDevice != null) "Verbunden mit: $targetDevice"
            else "Kein Gerät ausgewählt – erstes erkanntes Gerät wird verwendet."
        )
        addMessage("System", toolStatus())

        findViewById<View>(R.id.scanButton).setOnClickListener {
            Thread { deviceManager.refresh() }.start()
        }

        val input = findViewById<TextView>(R.id.inputEditText)
        findViewById<View>(R.id.sendButton).setOnClickListener {
            val text = input.text.toString().trim()
            if (text.isNotEmpty()) {
                input.text = ""
                processCommand(text)
            }
        }
        input.setOnEditorAction { _, _, _ ->
            findViewById<View>(R.id.sendButton).performClick()
            true
        }

        deviceManager.start()
    }

    override fun onDestroy() {
        deviceManager.stop()
        super.onDestroy()
    }

    private fun toolStatus(): String {
        val tools = ToolManager(applicationContext).allStatus()
        return tools.joinToString(" · ") {
            "${it.name}: ${if (it.installed) "✅" else "❌"}"
        }
    }

    private fun onDeviceClicked(entry: PortEntry) {
        targetDevice = entry.serial
        addMessage("System", "Zielgerät gesetzt: ${entry.label} (${entry.serial})")
        Thread {
            val info = deviceManager.deviceInfo(entry.serial)
            runOnUiThread { addMessage("System", info) }
        }.start()
    }

    private fun processCommand(input: String) {
        addMessage("Ich", input)
        Thread {
            val result = parser.parseAndExecute(input, targetDevice)
            runOnUiThread {
                addMessage("Assistent", result)
                findViewById<RecyclerView>(R.id.chatRecyclerView)
                    .scrollToPosition(chatAdapter.itemCount - 1)
            }
        }.start()
    }

    private fun addMessage(sender: String, text: String) {
        chatAdapter.add(ChatMessage(sender, text))
        findViewById<RecyclerView>(R.id.chatRecyclerView)
            .scrollToPosition(chatAdapter.itemCount - 1)
    }

    // ── Adapter ────────────────────────────────────────────────────────

    private inner class DeviceRowAdapter(
        private val onClick: (PortEntry) -> Unit
    ) : RecyclerView.Adapter<DeviceRowAdapter.VH>() {

        private val items = mutableListOf<PortEntry>()

        fun submit(newItems: List<PortEntry>) {
            items.clear()
            items.addAll(newItems)
            notifyDataSetChanged()
        }

        inner class VH(view: View) : RecyclerView.ViewHolder(view) {
            val label: TextView = view.findViewById(R.id.deviceLabel)
            val detail: TextView = view.findViewById(R.id.deviceDetail)
            val state: TextView = view.findViewById(R.id.deviceState)
            val dot: TextView = view.findViewById(R.id.stateDot)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
            VH(LayoutInflater.from(parent.context).inflate(R.layout.item_device_row, parent, false))

        override fun getItemCount(): Int = items.size

        override fun onBindViewHolder(holder: VH, position: Int) {
            val entry = items[position]
            holder.label.text = entry.label
            holder.detail.text = buildString {
                append(entry.serial)
                if (entry.vid.isNotEmpty()) append("  ·  ${entry.vid}/${entry.pid}")
                if (entry.vendor.isNotEmpty()) append("  ·  ${entry.vendor}")
            }
            holder.state.text = entry.state
            val dotColor = when {
                entry.state == "device" -> colorOf(R.color.dc_state_connected)
                entry.state.contains("unauthorized", true) || entry.state.contains("autorisiert") ->
                    colorOf(R.color.dc_state_unauthorized)
                else -> Color.parseColor("#455A64")
            }
            holder.dot.setBackgroundColor(dotColor)
            holder.itemView.setOnClickListener { onClick(entry) }
        }
    }

    private class ChatMessageAdapter : RecyclerView.Adapter<ChatMessageAdapter.VH>() {

        private val items = mutableListOf<ChatMessage>()

        fun add(message: ChatMessage) {
            items.add(message)
            notifyItemInserted(items.size - 1)
        }

        class VH(view: View) : RecyclerView.ViewHolder(view) {
            val sender: TextView = view.findViewById(R.id.messageSender)
            val text: TextView = view.findViewById(R.id.messageText)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
            VH(LayoutInflater.from(parent.context).inflate(R.layout.item_chat_message, parent, false))

        override fun getItemCount(): Int = items.size

        override fun onBindViewHolder(holder: VH, position: Int) {
            val msg = items[position]
            holder.sender.text = "${msg.sender} · ${java.text.DateFormat.getTimeInstance().format(msg.timestamp)}"
            holder.text.text = msg.text
            val bg = when (msg.sender) {
                "Ich" -> R.color.dc_bg_message_me
                "System" -> R.color.dc_bg_message_system
                else -> R.color.dc_bg_message_assistant
            }
            holder.text.setBackgroundResource(bg)
        }
    }

    private fun colorOf(resId: Int): Int =
        androidx.core.content.ContextCompat.getColor(this, resId)
}
