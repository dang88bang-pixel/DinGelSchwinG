package com.genesis.orchestrator.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.genesis.orchestrator.proto.NodeDetails
import com.genesis.orchestrator.proto.Relationship

/**
 * Popup shown after a node is tapped: renders the structured details plus the
 * Gemini-generated AI summary from the backend response.
 */
@Composable
fun NodeDetailPopup(
    node: GraphNode,
    details: NodeDetails?,
    relationships: List<Relationship>,
    aiSummary: String?,
    error: String?,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Node: ${node.label} (${node.id})") },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (error != null) {
                    Text(text = error, color = MaterialTheme.colorScheme.error)
                }

                details?.let { d ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text("Details", style = MaterialTheme.typography.titleSmall)
                            Text("Typ: ${d.deviceType.ifBlank { "–" }}")
                            Text("Status: ${d.status.ifBlank { "–" }}")
                            if (d.attributesMap.isNotEmpty()) {
                                Text("Attribute:", style = MaterialTheme.typography.labelMedium)
                                d.attributesMap.forEach { (k, v) ->
                                    Text("• $k = $v")
                                }
                            }
                        }
                    }
                }

                if (relationships.isNotEmpty()) {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text("Verbindungen", style = MaterialTheme.typography.titleSmall)
                            relationships.forEach { rel ->
                                Text("→ ${rel.type} → ${rel.targetLabel} (${rel.targetId})")
                            }
                        }
                    }
                }

                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text("KI-Zusammenfassung", style = MaterialTheme.typography.titleSmall)
                        Text(text = aiSummary ?: "Wird geladen…")
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("Schließen") }
        },
    )
}
