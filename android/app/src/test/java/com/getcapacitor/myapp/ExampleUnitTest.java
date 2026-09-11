package com.dingelschwinng.moeagent;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.dingelschwinng.moeagent.devicecontrol.models.AdbDevice;
import com.dingelschwinng.moeagent.devicecontrol.models.AdbState;
import com.dingelschwinng.moeagent.devicecontrol.models.ConnectionType;
import org.junit.Test;

/** REAL-IMPLEMENTATION 2026-09-11: validates Android-independent device models. */
public class ExampleUnitTest {
    @Test
    public void adbStateParserRecognisesKnownAndUnknownStates() {
        assertEquals(AdbState.DEVICE, AdbState.Companion.fromRaw("device"));
        assertEquals(AdbState.UNAUTHORIZED, AdbState.Companion.fromRaw(" UNAUTHORIZED "));
        assertEquals(AdbState.UNKNOWN, AdbState.Companion.fromRaw("unauthorised-typo"));
    }

    @Test
    public void deviceConnectionReflectsOnlyAuthorizedDeviceState() {
        AdbDevice connected = new AdbDevice("serial-1", AdbState.DEVICE, "Pixel", ConnectionType.USB);
        AdbDevice offline = new AdbDevice("serial-2", AdbState.OFFLINE, "", ConnectionType.WIFI);
        assertTrue(connected.getConnected());
        assertFalse(offline.getConnected());
    }
}
