# 📱 BLE Professional Suite – Native Flutter-App (Android & iOS)

Native, **vollständig autarke** BLE-App für Android/iOS – Entwicklung, Test &
Betrieb von BLE-Systemen und Mesh-Netzwerken. Kein externes Backend, keine
Cloud-Abhängigkeit: Jede BLE-Funktion nutzt die **echte Hardware des
Smartphones** (und optional einen USB-C-BLE-Dongle, nur Android).

Dieses Projekt ist das mobile Feldtest-Modul der HackGPT-CPS
NEXUS-BUILDER-Plattform (siehe `docs/ble-professional-suite.md` im
Repository-Stamm).

---

## Funktionen

| Bereich | Funktion | Technologie |
|---|---|---|
| **Scan** | Kontinuierlicher BLE-Scan, automatische Geräteklassifizierung (NTag / Token / Mesh / Peripherie), RSSI + Distanz | `flutter_blue_plus` |
| **GATT** | Explorer (Services/Characteristics/Descriptors), Read/Write (Hex/Dez/Bin/ASCII), Notifications, MTU | `flutter_blue_plus` |
| **Mesh** | Netzwerk-Erstellung (zentrale Schlüssel), Provisionierung, Topologie-Graph, Modelle, Pub/Sub, Gruppen, Nachrichten-Tracer | `nrf_mesh_flutter` |
| **Agent** | On-Device-KI-Agent (TinyLLaMA via TFLite) mit deterministischem Regel-Fallback; Aktions-Buttons; Freigabe-Pflicht für Aktionen | `tflite_flutter` |
| **Profile** | Profil-Cache (speichern/editor/anwenden) mit Schritt-Ausführung und Fortschritt | `sqflite` |
| **Logs** | Audit-Log mit Filter, CSV/JSON-Export, Teilen | `sqflite` + `share_plus` |
| **Peripheral** | Smartphone wirbt als BLE-Peripheral (geräteabhängig) | `flutter_ble_peripheral` |
| **Dongle** | USB-C-BLE-Dongle (nRF52840, CSR8510) per OTG (nur Android) | `usb_serial` + native `UsbDongleHost` |

## Projektstruktur

```
lib/
├── main.dart                  # App-Initialisierung (Permissions, Services)
├── main_screen.dart           # Bottom-Navigation: Scanner/GATT/Mesh/Agent/Logs
├── app/                       # App-Wrapper, Router, Theme
├── core/
│   ├── ble/                   # BLEService, MeshService, PeripheralService, UsbDongleService, BleAdapter
│   ├── agent/                 # AgentService (KI + Regeln), IntentParser, TinyLlama (TFLite)
│   ├── database/              # SQLite: DatabaseService, Profile/MeshNetwork/Log-DAOs
│   ├── models/                # BleDevice, GattStructure, BleProfile, MeshNetwork, LogEntry
│   └── utils/                 # HexConverter, RssiCalculator, PermissionHelper, Logger
├── features/
│   ├── scan/ gatt/ mesh/ profiles/ agent/ logs/ settings/
└── providers/                 # Riverpod-Provider (BLE, Mesh, Agent, Profile)
android/                       # Manifest + UsbDongleHost.kt (USB-OTG) + device_filter.xml
ios/                           # Info.plist (BLE-/Standort-Berechtigungen)
assets/
├── models/                    # tinyllama_quant.tflite (separat, siehe README)
├── profiles/                  # Standard-Konfigurationsprofile (JSON)
└── images/
```

## Installation & Start

Voraussetzung: [Flutter SDK](https://docs.flutter.dev/get-started/install) (3.x)
mit Android Studio / Xcode.

```bash
cd mobile/ble_professional_suite

flutter pub get

# Android
flutter run

# iOS (nur macOS)
cd ios && pod install && cd ..
flutter run
```

> **Alle Parts aktiv:** Beim Start werden über `ProviderInitializer.initializeAll()`
> BLE-, Mesh-, Peripheral-, Agent- und DB-Service robust initialisiert (ein
> fehlschlagender Service blockiert den Start nicht). Router
> (`AppRouter.onGenerateRoute`), Theme (`AppTheme`), RBAC (Agent-Controller),
> Scan-Zeitraum (Settings) und der Unprovisioned-Stream
> (`MeshService.unprovisionedUpdates`) sind verdrahtet – siehe
> [`docs/ble-loesungsweg.md`](../../docs/ble-loesungsweg.md).

> **Hinweis:** Die Plattform-Scaffolds (android/, ios/) sind bereits enthalten.
> Falls `flutter run` nach einem SDK-Update fehlende Dateien meldet, kann
> `flutter create --org com.bleprosuite --project-name ble_professional_suite .`
> fehlende Gerüstdateien regenerieren, ohne vorhandene Quellen zu überschreiben.

## On-Device-KI-Modell

Der KI-Agent lädt TinyLLaMA (`assets/models/tinyllama_quant.tflite`, ~350 MB).
Das Modell wird **nicht** im Git-Repository gecheckt – siehe
[`assets/models/README.md`](assets/models/README.md). Ohne Modell arbeitet die
App mit dem deterministischen Regel-Agenten (voll funktionsfähig, offline).

## Builds

```bash
# Debug-APK
flutter build apk --debug

# Release-APK (Signing: android/key.properties, siehe BUILD_INSTRUCTIONS im Stamm)
flutter build apk --release --split-per-abi

# IPA (nur macOS)
flutter build ios --release
```

## Berechtigungen

- **Android** (`AndroidManifest.xml`): `BLUETOOTH_SCAN/CONNECT/ADVERTISE`
  (Android 12+), `BLUETOOTH`/`ACCESS_FINE_LOCATION` (≤ Android 11),
  USB-Host-Feature für Dongles.
- **iOS** (`Info.plist`): `NSBluetoothAlwaysUsageDescription`,
  `NSBluetoothPeripheralUsageDescription`, `NSLocationWhenInUseUsageDescription`,
  Background-Modi `bluetooth-central`/`bluetooth-peripheral`.

## Tests

```bash
flutter test          # Widget-Smoke-Test (Hauptnavigation)

# Ohne Flutter-SDK verfügbare statische Checks (Klammern, Imports, XML/JSON/plist):
python3 tool/check_project.py
```

## Hinweise zum Produktivbetrieb

- **Kein Sniffer:** Ein Low-Level-Paket-Sniffer ist auf Smartphone-Hardware
  nicht möglich (Hardware-Limit) – dafür die Desktop-/Web-Suite nutzen.
- **Mesh:** `nrf_mesh_flutter` kapselt das nRF Mesh SDK (Nordic) – benötigt
  ein kompatibles Android-Gerät (BLE 5.x empfohlen).
- **Audit & Sicherheit:** Alle Aktionen werden lokal protokolliert; kritische
  Aktionen (Profil anwenden, Mesh löschen) verlangen eine Bestätigung –
  in Produktion zusätzlich WebAuthn (FIDO2) anbinden.
