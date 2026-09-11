package com.genesis.orchestrator.ui

import androidx.compose.ui.geometry.Offset
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RaycastUtilTest {
    private val identity = floatArrayOf(
        1f, 0f, 0f, 0f,
        0f, 1f, 0f, 0f,
        0f, 0f, 1f, 0f,
        0f, 0f, 0f, 1f,
    )

    @After
    fun clearScene() = RaycastUtil.clearScene()

    @Test
    fun convertsScreenCoordinatesToNdc() {
        assertEquals(Offset(-1f, 1f), RaycastUtil.screenToNdc(0f, 0f, 100f, 100f))
        assertEquals(Offset.Zero, RaycastUtil.screenToNdc(50f, 50f, 100f, 100f))
    }

    @Test
    fun selectsNearestRayAabbIntersection() {
        RaycastUtil.updateScene(identity, listOf(
            RaycastTarget("far", RayVector3(-.5f, -.5f, .4f), RayVector3(.5f, .5f, .8f)),
            RaycastTarget("near", RayVector3(-.5f, -.5f, -.8f), RayVector3(.5f, .5f, -.4f)),
        ))
        assertEquals("near", RaycastUtil.perform3DRaycast(Offset.Zero))
    }

    @Test
    fun returnsNullForAnEmptyScene() {
        assertNull(RaycastUtil.perform3DRaycast(Offset.Zero))
    }
}
