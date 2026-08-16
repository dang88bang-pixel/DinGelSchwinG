package com.genesis.orchestrator.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel

/**
 * Interactive node graph.
 *
 * Touch events are resolved through [HitTest] (raycasting). Tapping a node
 * sends a `GET_DETAILS` request; the result is rendered in a [NodeDetailPopup].
 */
@Composable
fun NodeGraphScreen(viewModel: NodeGraphViewModel = viewModel()) {
    Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            GraphCanvas(viewModel)

            Text(
                text = if (viewModel.connected) "Verbunden" else "Verbindung wird hergestellt…",
                color = if (viewModel.connected) Color(0xFF4CAF50) else Color(0xFFFFA726),
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .statusBarsPadding()
                    .padding(top = 8.dp),
            )

            if (viewModel.loading) {
                CircularProgressIndicator(
                    modifier = Modifier.align(Alignment.Center),
                )
            }

            viewModel.selectedNode?.let { node ->
                NodeDetailPopup(
                    node = node,
                    details = viewModel.details,
                    relationships = viewModel.relationships,
                    aiSummary = viewModel.aiSummary,
                    error = viewModel.error,
                    onDismiss = viewModel::dismissPopup,
                )
            }
        }
    }
}

@Composable
private fun GraphCanvas(viewModel: NodeGraphViewModel) {
    Canvas(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    while (true) {
                        val event = awaitPointerEvent()
                        val change = event.changes.firstOrNull()
                        if (change != null && change.pressed) {
                            val point = change.position
                            // Raycasting hit-test: a touch fires a perpendicular
                            // ray into the (orthographic) scene.
                            val hit = HitTest.hitTest(point, viewModel.nodes)
                            if (hit != null) {
                                viewModel.onNodeTapped(hit)
                            }
                            change.consume()
                        }
                    }
                }
            },
    ) {
        val selectedId = viewModel.selectedNode?.id

        // Simple edges between adjacent nodes (visual only).
        viewModel.nodes.zipWithNext().forEach { (a, b) ->
            drawEdge(a, b, Color(0xFF37474F))
        }

        viewModel.nodes.forEach { node ->
            val isSelected = node.id == selectedId
            drawNode(node, isSelected)
        }
    }
}

private fun DrawScope.drawEdge(a: GraphNode, b: GraphNode, color: Color) {
    drawLine(
        color = color,
        start = toPx(a.position),
        end = toPx(b.position),
        strokeWidth = 2.dp.toPx(),
    )
}

private fun DrawScope.drawNode(node: GraphNode, selected: Boolean) {
    val center = toPx(node.position)
    val radius = node.radius.dp.toPx()

    drawCircle(
        color = if (selected) Color(0xFF1E88E5) else Color(0xFF546E7A),
        radius = radius,
        center = center,
    )
    drawCircle(
        color = Color.White,
        radius = radius,
        center = center,
        style = androidx.compose.ui.graphics.drawscope.Stroke(width = 2.dp.toPx()),
    )
}

/** Convert a fractional (0..1) position into pixel coordinates. */
private fun DrawScope.toPx(position: Offset): Offset =
    Offset(position.x * size.width, position.y * size.height)
