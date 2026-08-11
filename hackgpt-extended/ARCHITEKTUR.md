# HackGPT-CPS — Architektur-Diagramme

**NEXUS-BUILDER v2.3** · Alle Diagramme sind Mermaid (rendert in GitHub/VS-Code/Markdown-Viewer mit Mermaid-Support). Die Live-Preview in Arena zeigt Mermaid als gerendertes Diagramm.

---

## 1. System-Überblick (Komponenten & Dienste)

```mermaid
flowchart TB
    subgraph Browser["Browser (Frontend: React + Vite :5173)"]
        UI[AccessConsole / OverviewPanel / NetworkPanel / PairingPanel / StatusBoard / Terminal]
        DISP[useDiscovery · useStatusBoard · useTerminal]
        ERR[Error-Hierarchie + Backoff + CircuitBreaker]
    end

    subgraph Server["Backend (Python)"]
        AUTH[Flask Auth :5000<br/>JWT · RBAC · CRUD · Pairing · Audit]
        BRIDGE[Terminal-Bridge :8765<br/>WS + PTY/SSH]
        SCAN[Discovery-Scanner :8766<br/>mDNS/SSDP/BLE + USB-Dongle]
        STATUS[Status-Board :8767<br/>Live-Präsenz + Device-Status]
        AUDIT[Audit-Trail (SQLite)]
        DB[(SQLite<br/>devices/clients/pairings/audit/users/webauthn)]
        WB[WebAuthn :5000<br/>FIDO2-Registrierung + ECDSA-Assertion]
        USERS[Nutzer-DB<br/>PBKDF2-Hashes (werkzeug)]
    end

    subgraph HW["Hardware / Netzwerk"]
        DONGLE[USB-C-Dongle]
        BLE[BLE-Token / NTag]
        NET[Netzwerkgeräte / WiFi]
    end

    UI --> AUTH
    DISP -->|wss| BRIDGE
    DISP -->|wss| SCAN
    DISP -->|wss| STATUS
    UI --> WB
    AUTH --> AUDIT
    AUTH --> DB
    AUTH --> USERS
    AUDIT --> DB
    BRIDGE --> DB
    BRIDGE --> DONGLE
    BRIDGE --> NET
    SCAN --> BLE
    SCAN --> DONGLE
    SCAN --> NET
    STATUS --> AUTH
```

---

## 2. Aktionskette (End-to-End, nachvollziehbar)

```mermaid
sequenceDiagram
    participant F as Frontend
    participant A as Auth (:5000)
    participant S as Status/Scanner/Bridge (WS)
    participant D as SQLite

    F->>A: POST /api/login
    A->>D: audit(auth.login)
    A-->>F: JWT (role)

    F->>A: POST /api/devices (bind)
    A->>A: require_device_right(write)
    A->>D: save device + audit(device.bind)
    A-->>F: 201 device

    F->>A: POST /api/pairings + sync
    A->>A: write-Recht auf alle Mitglieder
    A->>D: save + audit(pairing.create/sync)
    A-->>F: 200

    F->>S: WS discovery (snapshot) / WS terminal (open)
    S-->>F: Nodes / Terminal-Session

    F->>S: WS status (device.online)
    S-->>F: Live-Status gebundenes Gerät

    Note over F,A: Kritische Aktion (delete/Server/Kick)
    F->>A: POST /api/webauthn/challenge
    F->>A: POST /api/webauthn/assert (FIDO2)
    A-->>F: grant-token (einmalig)
    F->>A: DELETE/PATCH + X-WebAuthn token
    A->>A: consume_grant + require_device_right
    A->>D: save/delete + audit(result)
```

---

## 3. RBAC & CRUD-Rechtematrix

```mermaid
graph LR
    subgraph Roles["Rollen (L0–L5)"]
        GUEST[guest L0]
        OP[operator L1]
        SVC[service L2]
        DEV[developer L3]
        EXP[expert L4]
        EMG[emergency L5]
    end

    subgraph Rights["CRUD-Rechte (Lesen/Schreiben/Löschen/Ändern)"]
        HW[hardware]
        DG[dongle]
        BL[ble_token]
        NT[ntag]
        NW[network]
    end

    GUEST -->|read| NW
    OP -->|read| HW & NW
    SVC -->|R/W/U/D| HW & DG
    SVC -->|read| BL & NT & NW
    DEV -->|R/W/U/D| HW & DG & BL & NT & NW
    EXP -->|R/W/U/D| alles
    EMG -->|R/W/U/D + Override| alles
```

---

## 4. Fehlerresilienz (Modul 6)

```mermaid
flowchart LR
    subgraph Client["Client (Browser)"]
        C1[Error-Hierarchie AppError]
        C2[toUserMessage → UI]
        C3[Exponential Backoff]
        C4[Circuit Breaker]
        C5[Idle-Timeout]
    end
    subgraph Netz["Netzwerk"]
        N1[WS-Reconnect mit Backoff]
        N2[Stale-Removal TTL]
    end
    subgraph Server["Server"]
        S1[Global Error-Handler 400/401/403/404/500]
        S2[Eingabe-Validierung]
        S3[WebAuthn (FIDO2, wa_token) + RBAC-Guard]
        S4[Audit-Trail trace_id]
    end
    C1 --> C2
    C3 --> N1
    C4 --> N1
    N1 --> S1
    S1 --> S2
    S2 --> S3
    S3 --> S4
```

---

## 5. Infrastruktur (Docker Compose)

```mermaid
flowchart LR
    subgraph Compose["docker compose"]
        WEB[web :4173<br/>Vite Preview]
        AUTH[auth :5000]
        BRIDGE[terminal-bridge :8765]
        SCAN[discovery-scanner :8766<br/>network_mode: host]
        STATUS[status-board :8767]
    end
    WEB -->|/api proxy| AUTH
    WEB -->|/api/ws/*| BRIDGE
    WEB -->|/api/ws/*| SCAN
    WEB -->|/api/ws/*| STATUS
    SCAN -->|USB-C Dongle| HOST[(/dev/ttyACM*)]
```
