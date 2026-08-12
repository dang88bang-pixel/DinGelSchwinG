# WebSocket-Protokolle (Ergänzung zur OpenAPI-Spec)

REST-Endpunkte → [`openapi.yaml`](./openapi.yaml). Die Echtzeit-Kanäle laufen
über WebSockets (serverseitig RBAC-geprüft). Da WS kein OpenAPI-Standardfall
ist, hier die Nachrichten-Verträge. Alle Kanäle setzen TLS (`wss://`) voraus;
das JWT wird als Query-Parameter mitgegeben (WS-Handshake kann keine
Authorization-Header setzen — HTTPS verhindert Leaks, README §4).

Ports gemäß README-Verbindungsmatrix: **8765** Terminal, **8766** Discovery,
**8767** Status-Board — am Proxy unter `/api/ws/…` erreichbar.

---

## 1. `/api/ws/terminal` (Terminal-Bridge :8765)

Zweck: interaktive Hardware-/SSH-Session (xterm.js ↔ PTY).

**Handshake:** `wss://host:8765/?token=<JWT>&kind=hardware|dongle|network&target=<id>`

**Serverseitig vor Session-Start:**
1. `_authorize()` — JWT dekodieren, Action-Matrix
   (`hardware→service`, `dongle/network→developer`)
2. `_safety_interlock()` — VID/PID-Whitelist (nur bei `dongle`)

**Client → Server**

| Typ | Payload | Bedeutung |
|---|---|---|
| `stdin` | `{data: string}` | Tastatur-Eingabe |
| `resize` | `{cols:int, rows:int}` | Terminalgröße |
| `ping` | `{}` | Idle-Reset (Idle-Timeout 10 min, absolut 60 min) |

**Server → Client**

| Typ | Payload | Bedeutung |
|---|---|---|
| `stdout` | `{data: string}` | Ausgabe der PTY |
| `error` | `{code, message}` | strukturierter Fehler (s. u.) |
| `close` | `{reason}` | Session-Ende |

**Fehlercodes:** `RBAC_DENIED`, `DONGLE_MISSING` (VID nicht whitelisted),
`TERMINAL_SESSION_REJECTED` (z. B. SSH-Key fehlt), `TERMINAL_SESSION_TIMEOUT`
(Idle), `TERMINAL_SESSION_ERROR` (generisch). Keine Geheimnisse/Inhalte im Log.

---

## 2. `/api/ws/discovery` (Scanner :8766)

Zweck: kontinuierliche Erkennung (mDNS/SSDP/ARP + BLE via `bluetoothctl`),
Push statt Polling; Zyklus `SCAN_INTERVAL`, Stale-Removal nach `NODE_TTL`.

**Mindestrolle:** service. Überlauf-Schutz: `SCAN_MAX_CLIENTS` → Close `BUSY`.

**Server → Client** (jeweils JSON, `type` diskriminiert):

```jsonc
// Voller Zustand nach Connect:
{"type":"snapshot","nodes":[{
  "id":"…","kind":"network|dongle|ble_token|ntag|ble_mesh|ble_peripheral|hardware",
  "label":"…","lastSeen":"…","signal":{"rssi":-58},
  "usbVendorId":"0x2341","usbProductId":"0x0043",
  "autoBindable": true,                // Dongle: Client prüft Interlock
  // BLE Professional Suite – Zusatzfelder (nur bei kind ble_*):
  "deviceClass":"ntag|token|mesh|peripheral",  // automatische Klassifizierung
  "manufacturer":"NXP Semiconductors",
  "serviceUuids":["0000180a-…","0000fea9-…"],
  "connectable": true,
  "battery": 87,
  "provisioned": false                 // Mesh: bereits provisioniert?
}]}

// Delta während des Scan-Zyklus:
{"type":"update","node":{ /* wie oben (auch Label-/RSSI-Änderungen) */ }}
{"type":"remove","id":"…"}            // stale, kein Geist-Zustand

// BLE Professional Suite – Ereignisse (Agent & GATT/Mesh/Tests):
{"type":"ble.classified","node":{"id":"…","deviceClass":"ntag"}}
{"type":"ble.connected","id":"…","parallel":3}         // ≤ 20 parallel
{"type":"ble.gatt","deviceId":"…","op":"read|write|notify|mtu","uuid":"…"}
{"type":"ble.mesh","network":"…","op":"create|provision|pubsub|ttl|model|trace"}
{"type":"ble.test","suite":"suite-ntag","case":"NDEF-Read","status":"pass|fail"}
{"type":"ble.audit","entry":{"user":"…","action":"gatt_write","detail":"…"}}
```

Fehler: `{ "type":"error", "code":"RBAC_DENIED" }` + Close.

> **RBAC (BLE Professional Suite):** `kind ble_*`-Nodes liefert der Scanner ab
> Rolle `service` (L2); GATT-Schreibzugriffe/Mesh-Operationen erfordern
> `developer` (L3). Kritische Aktionen (Mesh löschen, Konfiguration
> überschreiben, Fehlersimulation) werden serverseitig erst nach
> WebAuthn-Bestätigung ausgeführt (siehe [`ble-professional-suite.md`](./ble-professional-suite.md)).

---

## 3. `/api/ws/status` (Live-Präsenz & Gerätestatus :8767)

Zweck: Multi-Client-Präsenz (online/offline, Rolle, Gerät, lastSeen) +
Live-Status gebundener Geräte. Heartbeat/Ping + Stale-Detection (TTL).

**Mindestrolle:** service. Überlauf-Schutz: `STATUS_MAX_CLIENTS` → Close `BUSY`.

**Server → Client**

```jsonc
{"type":"snapshot","clients":[{"id":"…","role":"service","device":"…",
  "mode":"client","online":true,"lastSeen":"…"}],
 "devices":[{"id":"…","online":true,"status":"ok"}]}

{"type":"client.online","client":{/*…*/}}
{"type":"client.offline","id":"…"}
{"type":"device.online","id":"…"}
{"type":"device.status","id":"…","status":"ok|warn|error"}
{"type":"device.offline","id":"…"}
```

**Client → Server:** `ping`/Heartbeat; Geräte-Reports (`device.status`) aus
`useStatusBoard`.

> Parallel existiert die REST-Registry via `POST /api/clients/register`
> (Heartbeat), damit REST-Sicht und Live-Präsenz konsistent bleiben.

---

## 4. `/ws/status` (Desktop-Konsole, localhost:5000)

Die Python-Desktop-Konsole (`desktop/`) nutzt denselben Vertrag abgespeckt
auf `localhost:5000` (`/api/devices`, `/api/clients`, `/api/workflows`,
`/api/tests`, `/api/system`). Fällt das Backend aus, liefert der eingebaute
**Mock-Provider** plausible Daten — erkennbar am Marker `(mock)` in der
Status-Bar.
