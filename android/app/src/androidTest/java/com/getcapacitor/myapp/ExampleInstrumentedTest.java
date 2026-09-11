package com.dingelschwinng.moeagent;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import android.content.Context;
import android.content.pm.PackageInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/** REAL-IMPLEMENTATION 2026-09-11: installation-level identity smoke test. */
@RunWith(AndroidJUnit4.class)
public class ExampleInstrumentedTest {
    @Test
    public void installedAppHasExpectedIdentityAndPackageMetadata() throws Exception {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.dingelschwinng.moeagent", appContext.getPackageName());
        PackageInfo packageInfo = appContext.getPackageManager().getPackageInfo(appContext.getPackageName(), 0);
        assertNotNull(packageInfo.applicationInfo);
        assertNotNull(packageInfo.versionName);
    }
}
