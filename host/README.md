# Host-Backend – BLE Professional Suite (REST + WebSockets + Terminal)

Das Host-Backend implementiert die serverseitigen Ebenen der
BLE Professional Suite:

| Ebene | Umsetzung | Port |
|---|---|---|
| **API (REST)** | Flask, JWT + RBAC, WebAuthn-Grants, Prometheus-Metriken, OpenAPI-Spezifikation ausgeliefert | 5000 |
| **Terminal (PTY-Bridge)** | `websockets`-Kanal :8765 – xterm.js ↔ PTY/SSH (RBAC + VID-Interlock + Timeouts) | 8765 |
| **Discovery** | `websockets`-Kanal :8766 – Scanner (BLE via bleak, ARP, USB-Dongles), snapshot/update/remove-Push | 8766 |
| **Live-Status** | `websockets`-Kanal :8767 – Clients, Geräte, Workflows (Heartbeat-TTL) | 8767 |
| **Controller** | `POST /api/agent/ask` – deterministische Agent-Engine (Intents → BLE-Tools), Audit je Schritt | 5000 |

## Start

```bash
pip install -r host/requirements.txt        # flask, websockets, PyJWT (+ optional bleak)
python3 -m host.main
```

## API-Kurzreferenz

```bash
# Health
curl http://localhost:5000/api/health

# Login (Demo-User: admin/admin, developer/dev123, service/svc123)
TOKEN=$(curl -s -X POST http://localhost:5000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"developer","password":"dev123"}' | jq -r .token)

# BLE-Scan (echte Hardware via bleak, sonst sim)
curl -X POST http://localhost:5000/api/ble/scan -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"action":"start"}'

# Controller/Agent
curl -X POST http://localhost:5000/api/agent/ask -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"text":"scanne ble"}'

# WebAuthn (kritische Aktionen)
CH=$(curl -s -X POST http://localhost:5000/api/webauthn/challenge \
  -H "Authorization: Bearer $TOKEN" | jq -r .challenge)
curl -s -X POST http://localhost:5000/api/webauthn/assert \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"challenge\":\"$CH\"}"

# Metriken (Prometheus)
curl http://localhost:5000/api/metrics -H "Authorization: Bearer $TOKEN"

# OpenAPI-Spezifikation (docs/openapi.yaml)
curl http://localhost:5000/api/openapi.yaml
```

## Terminal (xterm.js)

Web-App: Header-Button **„Terminal“** → Access Console → Ziel wählen.
Die Web-App verbindet sich über den Vite-Proxy (`/api/ws/terminal` → :8765).

```bash
# Direkt (ohne Proxy):
wscat -c "ws://localhost:8765?token=$TOKEN&kind=hardware&target="
# {"type":"stdin","data":"ls\n"}  →  {"type":"stdout","data":"…"}
```

RBAC: `hardware` → service (L2), `dongle`/`network` → developer (L3).
Kritische Terminal-Ziele prüfen zusätzlich die VID-Whitelist.

## Tests

```bash
python3 -m unittest discover -s host/tests -v   # 26 Tests (Auth/RBAC/API/Controller/Terminal)
```

## Hinweise Produktivbetrieb

- JWT-Secret über `NEXUS_JWT_SECRET` setzen (≥32 Bytes).
- Demo-User nur für Entwicklung – Produktion: LDAP/OAuth2
  (siehe `docs/production-backend.md`).
- WebAuthn ist als Demo-Grant-Flow implementiert – Produktion: echte FIDO2-
  Assertion anbinden.
- `host/data/audit.json` wird zur Laufzeit erzeugt (in .gitignore).
