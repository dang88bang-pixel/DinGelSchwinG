# MoE Agent Chat - APK Build Instructions

## Prerequisites

✅ **Required Software** (Stand: Capacitor 8 / AGP 8.13 / Gradle 8.14.3)
- Node.js 20+ (empfohlen 22 – der CI-Workflow nutzt 22) & npm
- Java Development Kit **JDK 21** – die Android-Module kompilieren auf `VERSION_21`
- Android SDK **Platform `android-36`** (Android 16) – `compileSdk`/`targetSdk` = 36
- Android Build Tools **36.0.0**, `platform-tools` (adb)
- Gradle 8.14.3 (wird über `android/gradle/wrapper` automatisch geholt)

Zielbereich der APKs: **Android 11 (API 30) bis Android 16 (API 36)** – `minSdk 30`
in `android/variables.gradle`, `targetSdk 36` (Play-Store-Pflicht seit 2026-08-31).
Der Build bricht ab, wenn ein APK davon abweicht (Prüfung über `aapt2 dump badging`).

✅ **For Release Builds:**
- Keystore file for signing
- Google Play Developer Account (for distribution)

🔧 **Device-Control-Subsystem (ADB/Fastboot):** Ein echtes ARM64-`adb`
(LADB, Apache-2.0) liegt bereits in `android/app/src/main/assets/devicecontrol/`.
`fastboot` wird im CI-Build automatisch aus dem Termux-Paket `android-tools`
ergänzt (fail-soft); lokal geht das mit:

```bash
bash scripts/fetch-android-tools.sh
# oder eigenes statisches ARM64-Build:
FASTBOOT_URL=… bash scripts/fetch-android-tools.sh
```

Ohne Binaries bleibt die App baubar – ADB/Fastboot-Funktionen melden dann eine
klare Handlungsanweisung (Details: `docs/device-control.md`).

---

## 🤖 GitHub Actions – automatischer APK-Build & Release

Das Repository enthält einen CI-Workflow (`.github/workflows/build-apk.yml`),
der bei jedem Push auf `main` (sowie manuell über *Actions → Build APK →
Run workflow*) die APKs automatisch baut:

**Was der Workflow macht** (`.github/workflows/build-apk.yml`):
1. Node.js 22 + JDK 21 (Temurin) + Android SDK, explizit `platforms;android-36` und
   `build-tools;36.0.0` (API 36 braucht AGP ≥ 8.9.1 – hier: AGP 8.13.0)
2. `npm ci` → `npm run lint` → `npm run type-check` → `npm run build`
3. `npx cap sync android` + `npx cap doctor` (die Android-Plattform ist versioniert)
4. `./gradlew assembleDebug` und `assembleRelease`
5. **Prüfung**: `aapt2 dump badging` muss `sdkVersion:'30'`, `targetSdkVersion:'36'`
   und die BLE-Permissions melden – sonst bricht der Build
6. Artefakt `DinGelSchwinG-APK` mit `DinGelSchwinG-v<version>-{debug,release}.apk` +
   `SHA256SUMS` (Artefakt bleibt 30 Tage; Retention via `retention-days`)

**APK aus einem Lauf holen** (auch von einem Branch, z. B. vor dem Merge):
```bash
git push origin HEAD
gh workflow run build-apk.yml --repo dang88bang-pixel/DinGelSchwinG --ref "$(git branch --show-current)"
gh run list --workflow build-apk.yml --limit 3
gh run watch <lauf-id>
gh run download <lauf-id> -n DinGelSchwinG-APK -D apk/
sha256sum -c apk/SHA256SUMS        # bzw. im Artefakt: cd apk && sha256sum -c SHA256SUMS
adb install -r apk/DinGelSchwinG-v*-debug.apk
```

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

✅ **PortView (native Capacitor-Brücke) – ohne Extra-Plugin**
- `android/app/src/main/java/com/dingelschwinng/moeagent/PortViewPlugin.java`
  registriert in `MainActivity.onCreate` (`registerPlugin(PortViewPlugin.class)` **vor**
  `super.onCreate()`), Methoden `discover` (UDP-Broadcast :18791 + HTTP-Probe, optional
  /24-Sweep) und `ping`. Läuft im eigenen Executor, blockiert keinen UI-Thread.
- Berechtigungen: `INTERNET` (+ `ACCESS_NETWORK_STATE` für die Interface-Liste).
- Klartext-HTTP zu Werk-IPs: `res/xml/network_security_config.xml` (freigeschaltet,
  weil PortView sonst in Release-Builds scheitert). Gehärtete Variante für TLS-Rollouts:
  `network_security_config_hardened.xml` – im Manifest eine Zeile tauschen.
- Die App braucht keine `localhost`-URL: `src/lib/endpoint.ts` hält den gefundenen
  Endpunkt und alle `fetch`-Aufrufe laufen über `apiUrl()`/`gatewayUrl()`.

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
│   │   └── MoEChatInterface.tsx    (Main Chat Component)
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

**Version:** 1.0.0 (Android 11–16 / API 30–36, JDK 21, SDK 36) | **Last Updated:** 2026-09-09 | **Status:** ✅ Ready for Build

Details zu den neuen App-Funktionen: [`docs/portview-import.md`](docs/portview-import.md).
