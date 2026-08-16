package com.genesis.orchestrator.ui

import androidx.compose.ui.geometry.Offset
import kotlin.math.sqrt

/**
 * A node in the rendered graph. Positions are in the Canvas coordinate space.
 */
data class GraphNode(
    val id: String,
    val label: String,
    val position: Offset,
    val radius: Float = 28f,
)

/**
 * Raycasting hit-test.
 *
 * The graph is rendered with an orthographic (top-down) projection, so a touch
 * event corresponds to a ray fired perpendicular to the screen through the
 * touch point. In that orthographic case the ray/sphere test degenerates to a
 * 2D ray/circle intersection; [raycast] keeps the general form so the same
 * code path can be reused when the scene gains depth/parallax.
 */
object HitTest {

    /**
     * Cast a ray from [origin] along [direction] and return the closest
     * intersected [GraphNode], or `null` if none is hit.
     */
    fun raycast(
        origin: Offset,
        direction: Offset,
        nodes: List<GraphNode>,
    ): GraphNode? {
        val length = sqrt(direction.x * direction.x + direction.y * direction.y)
        if (length == 0f) return null
        val dir = Offset(direction.x / length, direction.y / length)

        var best: GraphNode? = null
        var bestDistance = Float.MAX_VALUE
        for (node in nodes) {
            val t = intersectRayCircle(origin, dir, node.position, node.radius) ?: continue
            if (t < bestDistance) {
                bestDistance = t
                best = node
            }
        }
        return best
    }

    /**
     * Orthographic convenience: a touch at [point] fires a perpendicular ray,
     * so the nearest node containing the point wins.
     */
    fun hitTest(point: Offset, nodes: List<GraphNode>): GraphNode? =
        nodes.filter { (it.position - point).getDistance() <= it.radius }
            .minByOrNull { (it.position - point).getDistance() }

    /** Analytic ray/circle intersection; returns the near hit distance or null. */
    private fun intersectRayCircle(
        origin: Offset,
        dir: Offset,
        center: Offset,
        radius: Float,
    ): Float? {
        val ocX = origin.x - center.x
        val ocY = origin.y - center.y
        val b = 2f * (dir.x * ocX + dir.y * ocY)
        val c = ocX * ocX + ocY * ocY - radius * radius
        var discriminant = b * b - 4f * c
        if (discriminant < 0f) return null
        discriminant = sqrt(discriminant)
        val t = (-b - discriminant) / 2f
        return if (t >= 0f) t else null
    }
}
