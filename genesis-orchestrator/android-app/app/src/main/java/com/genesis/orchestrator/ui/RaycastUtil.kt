package com.genesis.orchestrator.ui

import androidx.compose.ui.geometry.Offset

/**
 * Screen-space → NDC conversion for the Filament-based 3D raycasting path.
 *
 * Touch coordinates (pixels, origin top-left) are mapped to Normalized Device
 * Coordinates (NDC) in the range [-1, 1] with +Y up — the space in which the
 * inverse view-projection matrix is applied to reconstruct a world-space ray:
 *
 *     rayOrigin = inverseViewProjection * (ndcX, ndcY, -1)
 *     rayDir    = normalize( inverseViewProjection * (ndcX, ndcY, 1) - rayOrigin )
 *
 * The orthographic 2D fallback used by the Canvas graph lives in [HitTest];
 * this utility is the entry point for the full 3D overlay when Filament nodes
 * (AABB bounding boxes) are hit-tested.
 */
object RaycastUtil {

    /** Convert a pixel-space touch point to NDC given the viewport size. */
    fun screenToNdc(screenX: Float, screenY: Float, viewWidth: Float, viewHeight: Float): Offset {
        if (viewWidth <= 0f || viewHeight <= 0f) return Offset(0f, 0f)
        val ndcX = (screenX / viewWidth) * 2f - 1f
        val ndcY = 1f - (screenY / viewHeight) * 2f
        return Offset(ndcX, ndcY)
    }

    /**
     * Placeholder for the Filament AABB hit-test. In production this applies
     * the inverse view-projection matrix to [ndc] and intersects the resulting
     * ray against the AABB of each rendered node, returning the node id.
     */
    fun perform3DRaycast(ndc: Offset): String? {
        // Integration point for the Filament Renderer's inverse matrix.
        // Dummy evaluation for demonstration purposes.
        return null
    }
}
