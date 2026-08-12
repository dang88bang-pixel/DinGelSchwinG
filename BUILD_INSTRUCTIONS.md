# MoE Agent Chat - APK Build Instructions

## Prerequisites

✅ **Required Software:**
- Node.js 20.19+ (oder 22.12+) & npm
- Java Development Kit (JDK) 21 (Capacitor 8 / Gradle Android build)
- Android SDK (API 36+)
- Android Build Tools 34.0.0+
- Gradle 8.0+

✅ **For Release Builds:**
- Keystore file for signing
- Google Play Developer Account (for distribution)

---

## 🤖 GitHub Actions – automatischer APK-Build & Release

Das Repository enthält einen CI-Workflow (`.github/workflows/build-apk.yml`),
der bei jedem Push auf `main` (sowie manuell über *Actions → Build APK →
Run workflow*) die APKs automatisch baut:

**Was der Workflow macht:**
1. Installiert Node.js, JDK und das Android SDK (für Capacitor 8 ist JDK 21 erforderlich; falls der GitHub-Workflow noch JDK 17 setzt, muss ein Maintainer die Workflow-Datei entsprechend anpassen)
2. `npm ci` → `npm run lint` → `npm run type-check` → `npm run build`
3. `npx cap sync android` (die Android-Plattform ist versioniert, `android/`)
4. Baut **Debug-APK** und **Release-APK**
5. Lädt beide APKs als **Artifact** hoch

**GitHub Release mit APK (bei Tags):**
```bash
git tag v1.0.0
git push origin v1.0.0
```
Sobald ein Tag mit `v*` gepusht wird, erstellt der Workflow automatisch ein
**GitHub Release** mit beiden APKs als Download-Anhang.

**Signiertes Release-APK (optional):**
Ohne Keystore wird das Release-APK mit dem Debug-Schlüssel signiert
(installierbar, nicht für den Play Store geeignet). Für echtes Signieren
im Repository unter *Settings → Secrets and variables → Actions* anlegen:

| Secret | Beschreibung |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Keystore-Datei als Base64 (`base64 -w0 release.keystore`) |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore-Passwort |
| `ANDROID_KEY_ALIAS` | Alias des Signierschlüssels |
| `ANDROID_KEY_PASSWORD` | Schlüssel-Passwort |

---

## Quick Start (Debug APK)

### Option 1: Automated Build Script

```bash
# Make script executable
chmod +x build.sh

# Run build
./build.sh
```

### Option 2: Manual Step-by-Step

```bash
# 1. Install dependencies
npm install

# 2. Build web assets
npm run build

# 3. Add Android platform (first time only)
npx cap add android

# 4. Sync with Capacitor
npx cap sync android

# 5. Build Debug APK
npm run android:apk

# Output: android/app/build/outputs/apk/debug/app-debug.apk
```

---

## Installation on Device

### Via ADB (Recommended)

```bash
# Connect device via USB (USB Debugging must be enabled)

# Install APK
adb install -r android/app/build/outputs/apk/debug/app-debug.apk

# Or use npm script
npm run android:install

# Launch app
adb shell am start -n com.dingelschwinng.moeagent/.MainActivity
```

### Via Android Studio

1. Open Android Studio
2. Select "Open" → navigate to `android/` folder
3. Connect device
4. Click "Run" → Select device

---

## Release Build (Google Play)

### Step 1: Create Signing Key

```bash
keytool -genkey -v -keystore android/app/release.keystore \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias moe-agent-key
```

### Step 2: Configure Gradle

Create `android/app/gradle.properties`:

```properties
storeFile=release.keystore
storePassword=YOUR_PASSWORD
keyAlias=moe-agent-key
keyPassword=YOUR_PASSWORD
```

### Step 3: Build Release APK

```bash
chmod +x build-release.sh
./build-release.sh

# Or manually
npm run build
npx cap sync android
npm run android:apk:release
```

### Step 4: Verify APK

```bash
# Check signing
jarsigner -verify -verbose android/app/build/outputs/apk/release/app-release.apk

# Check package info
aapt dump badging android/app/build/outputs/apk/release/app-release.apk
```

### Step 5: Upload to Play Store

1. Go to Google Play Console
2. Create new app: "MoE Agent Chat"
3. Upload APK under "Internal Testing" or "Production"
4. Fill metadata (description, screenshots, etc.)
5. Submit for review

---

## Features Included

✅ **MoE Agent Chat Interface**
- Multi-agent conversation
- Real-time messaging
- Agent management (Create/Edit/Delete)

✅ **System-Critical Permission Guards**
- 10 predefined permission rules
- Network access control (read/write/external)
- USB-C device management
- Filesystem protections
- System command execution guards
- Process termination controls

✅ **Permission Management**
- User confirmation dialogs
- Timed grants (1/5/15/60 minutes)
- Permanent grants
- Audit trail logging
- Risk-level indicators (CRITICAL warnings)

✅ **Network & USB-C Focus**
- `network-write` → Requires confirmation
- `network-external` → Requires confirmation
- `usb-read` → Device enumeration
- `usb-write` → Requires confirmation
- `usb-dongle-flash` → CRITICAL (firmware updates)

---

## Troubleshooting

### Build Errors

**"Command failed: npx cap add android"**
- Ensure Android SDK is installed
- Set `ANDROID_HOME` environment variable

**"Gradle sync failed"**
- Clean gradle: `./gradlew clean`
- Invalidate Android Studio cache

### Installation Issues

**"Installation failed"**
```bash
# Clear app data
adb shell pm clear com.dingelschwinng.moeagent

# Uninstall and reinstall
adb uninstall com.dingelschwinng.moeagent
npm run android:install
```

**"USB Debugging not recognized"**
- Enable Developer Options (tap Build Number 7x)
- Enable USB Debugging
- Grant USB Debugging permission on device

---

## Useful Commands

```bash
# View device logs
adb logcat | grep MoE

# Check installed apps
adb shell pm list packages | grep dingelschwinng

# Get app info
aapt dump badging android/app/build/outputs/apk/debug/app-debug.apk

# Monitor build
cd android && ./gradlew build --stacktrace

# Force rebuild
npm run build && npx cap sync android && npm run android:apk
```

---

## File Structure

```
dingelschwinng/
├── src/
│   ├── components/
│   │   ├── NetworkDashboard.tsx    (Hauptansicht)
│   │   └── AgentConsole.tsx        (Agent-Konsole)
│   ├── main.tsx
│   ├── App.tsx
│   └── index.css
├── android/                         (Auto-generated by Capacitor)
├── capacitor.config.json            (Capacitor Configuration)
├── package.json                     (Dependencies & Scripts)
├── vite.config.ts                   (Build Configuration)
├── tsconfig.json                    (TypeScript Configuration)
├── tailwind.config.js               (CSS Framework)
├── build.sh                         (Debug Build Script)
├── build-release.sh                 (Release Build Script)
└── BUILD_INSTRUCTIONS.md            (This file)
```

---

## Support

For issues or feature requests:
1. Check troubleshooting section above
2. Review Capacitor docs: https://capacitorjs.com/
3. Check Android documentation: https://developer.android.com/
4. Open GitHub issue: https://github.com/dang88bang-pixel/DinGelSchwinG/issues

---

**Version:** 1.0.0 | **Last Updated:** 2026-08-08 | **Status:** ✅ Ready for Build
