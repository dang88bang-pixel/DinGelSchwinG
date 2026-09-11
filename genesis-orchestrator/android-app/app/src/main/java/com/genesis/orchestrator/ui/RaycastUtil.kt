package com.genesis.orchestrator.ui

import androidx.compose.ui.geometry.Offset
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

// REAL-IMPLEMENTATION 2026-09-11
/** A 3D point in the renderer's world coordinate system. */
data class RayVector3(val x: Float, val y: Float, val z: Float) {
    operator fun minus(other: RayVector3) = RayVector3(x - other.x, y - other.y, z - other.z)
    operator fun plus(other: RayVector3) = RayVector3(x + other.x, y + other.y, z + other.z)
    operator fun times(scale: Float) = RayVector3(x * scale, y * scale, z * scale)

    fun normalized(): RayVector3? {
        val length = sqrt(x * x + y * y + z * z)
        return if (length > 0.00001f && length.isFinite()) RayVector3(x / length, y / length, z / length) else null
    }
}

/** Axis-aligned bounds and node id supplied by the active 3D renderer. */
data class RaycastTarget(val id: String, val min: RayVector3, val max: RayVector3)

/** Renderer state needed to reconstruct a world-space camera ray. */
data class RaycastScene(val inverseViewProjection: FloatArray, val targets: List<RaycastTarget>) {
    init {
        require(inverseViewProjection.size == 16) { "inverseViewProjection must contain 16 values" }
    }
}

/**
 * Screen-space → NDC conversion plus ray/AABB hit testing. The renderer calls
 * [updateScene] each frame after computing its inverse view-projection matrix;
 * this keeps the original [perform3DRaycast] API usable without global fake
 * nodes or a Filament dependency.
 */
object RaycastUtil {
    @Volatile
    private var scene: RaycastScene? = null

    /** Convert a pixel-space touch point to NDC given the viewport size. */
    fun screenToNdc(screenX: Float, screenY: Float, viewWidth: Float, viewHeight: Float): Offset {
        if (viewWidth <= 0f || viewHeight <= 0f) return Offset.Zero
        return Offset(
            x = (screenX / viewWidth) * 2f - 1f,
            y = 1f - (screenY / viewHeight) * 2f,
        )
    }

    /** Update the exact render state used by [perform3DRaycast]. */
    fun updateScene(inverseViewProjection: FloatArray, targets: Collection<RaycastTarget>) {
        scene = RaycastScene(inverseViewProjection.copyOf(), targets.filter { it.id.isNotBlank() })
    }

    /** Clear renderer state when its surface is destroyed. */
    fun clearScene() {
        scene = null
    }

    /**
     * Return the nearest rendered target hit by a ray through [ndc], or null
     * when no renderer state exists/no target intersects. No arbitrary node is
     * selected for an invalid matrix or an empty scene.
     */
    fun perform3DRaycast(ndc: Offset): String? {
        val current = scene ?: return null
        val origin = unproject(current.inverseViewProjection, ndc.x, ndc.y, -1f) ?: return null
        val far = unproject(current.inverseViewProjection, ndc.x, ndc.y, 1f) ?: return null
        val direction = (far - origin).normalized() ?: return null
        return current.targets
            .mapNotNull { target -> intersectRayAabb(origin, direction, target)?.let { distance -> target.id to distance } }
            .minByOrNull { (_, distance) -> distance }
            ?.first
    }

    /** Multiply column-major OpenGL/Filament matrix by an NDC homogeneous point. */
    private fun unproject(matrix: FloatArray, x: Float, y: Float, z: Float): RayVector3? {
        val outX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]
        val outY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]
        val outZ = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]
        val outW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15]
        if (!outW.isFinite() || abs(outW) < 0.00001f) return null
        return RayVector3(outX / outW, outY / outW, outZ / outW)
    }

    /** Slab intersection; return the first non-negative hit distance. */
    private fun intersectRayAabb(origin: RayVector3, direction: RayVector3, target: RaycastTarget): Float? {
        var near = Float.NEGATIVE_INFINITY
        var far = Float.POSITIVE_INFINITY
        val originValues = floatArrayOf(origin.x, origin.y, origin.z)
        val directionValues = floatArrayOf(direction.x, direction.y, direction.z)
        val minValues = floatArrayOf(target.min.x, target.min.y, target.min.z)
        val maxValues = floatArrayOf(target.max.x, target.max.y, target.max.z)
        for (axis in 0..2) {
            val low = min(minValues[axis], maxValues[axis])
            val high = max(minValues[axis], maxValues[axis])
            val component = directionValues[axis]
            if (abs(component) < 0.00001f) {
                if (originValues[axis] < low || originValues[axis] > high) return null
                continue
            }
            val first = (low - originValues[axis]) / component
            val second = (high - originValues[axis]) / component
            near = max(near, min(first, second))
            far = min(far, max(first, second))
            if (near > far) return null
        }
        return when {
            far < 0f -> null
            near >= 0f -> near
            else -> far
        }
    }
}
