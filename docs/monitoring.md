# 📈 Monitoring & Observability (Prometheus + Loki + Grafana)

Der Stack liegt unter `deploy/monitoring/` und ist auf das **portierte LobeChat-Feature-Set**
dieser App erweitert: Agent-Läufe (Zeit/Tokens/Kosten/Cache), MCP-Bridge und das mobile
BLE-Gateway werden aus einer Quelle gespeist – die **Live-Statusleiste**, das **Live-Dashboard**
und **Grafana** zeigen damit dieselben Zahlen.

```bash
cp deploy/.env.example deploy/.env      # GRAFANA_ADMIN_PASSWORD + SLACK_WEBHOOK_URL setzen
docker compose -f deploy/monitoring/docker-compose.monitoring.yml \
  --env-file deploy/.env up -d
# Prometheus :9090 · Grafana :3000 (admin) · Loki :3100 · Alertmanager :9093 · Promtail :9080
```

Die zwei neuen Jobs (`mcp-bridge`, `mobile-gateway`) laufen **auf dem Host**, nicht im Container –
deshalb enthält `docker-compose.monitoring.yml` für Prometheus
`extra_hosts: ["host.docker.internal:host-gateway"]` (Linux braucht das zwingend, Docker Desktop
bringt es mit).`alert-rules.yml` ist ebenfalls gemountet, weil `prometheus.yml` die Datei unter
`/etc/prometheus/alert-rules.yml` erwartet.

| Datei | Zweck |
|---|---|
| `prometheus/prometheus.yml` | Scrape-Jobs: `nexus-backend`, `prometheus`, `loki`, **`mcp-bridge`**, **`mobile-gateway`** |
| `prometheus/alert-rules.yml` | Gruppen `nexus-backend` (BackendDown, Http5xxRate, …) und **`mcp-ble`** (McpBridgeDown, MobileGatewayDown, AccessControlDenySpike, BleTamperDetected) |
| `alertmanager/alertmanager.yml` | Routing → Slack (`slack_api_url: ${SLACK_WEBHOOK_URL}`) |
| `loki/loki-config.yml` | Loki-Aufnahme, `retention_period: 720h` |
| `promtail/promtail-config.yml` | docker_sd für die App-Container **und** Job `gateway-audit` (JSONL des BLE-Gateways) |
| `grafana/provisioning/datasources/datasources.yml` | Prometheus (default) + Loki |
| `grafana/provisioning/dashboards/dashboards.yml` | Datei-Provisioning, `updateIntervalSeconds: 30` |
| `grafana/dashboards/nexus-overview.json` | **14 Panels**: Backend, HTTP-Rate, Logs, plus Zeile „MCP & mobiles BLE-Gateway“ |
| `docker-compose.monitoring.yml` | Orchestrierung, Host-Mount `DGS_GATEWAY_DATA → /host/gateway-data` |

## 1️⃣ Metrikquellen

### MCP-Bridge (`mcp/bridge.mjs`, `GET :8790/metrics`)

| Metrik | Typ | Bedeutung |
|---|---|---|
| `dingelschwing_mcp_up` | gauge | 1 wenn der stdio-MCP-Prozess (`mcp-mobile-server`) verbunden ist |
| `dingelschwing_mcp_tools_total` | gauge | Anzahl registrierter Tools (31) |
| `dingelschwing_mcp_calls_total` | counter | Tool-Aufrufe insgesamt |
| `dingelschwing_mcp_errors_total` | counter | fehlgeschlagene Aufrufe (Timeout, Tool-Fehler, MCP getrennt) |
| `dingelschwing_mcp_call_duration_ms_sum` | counter | Latenzsumme → `rate(...)/rate(calls)` = Ø ms |
| `dingelschwing_mcp_cache_hit_ratio` | gauge | Trefferquote des 8-s-Antwortcaches |
| `dingelschwing_mcp_tool_calls{tool="…"}` | counter | Aufrufe pro Tool |
| `dingelschwing_agent_runs_total` | counter | Agent-Läufe (UI **und** Desktop-Konsole melden nach `/mcp/metrics/run`) |
| `dingelschwing_agent_run_duration_ms_sum` | counter | Laufzeit |
| `dingelschwing_agent_tokens_total` | counter | Token-Schätzung/-Zählung |
| `dingelschwing_agent_cost_usd_sum` | counter | Kosten (bei lokalem Modell 0 → zeigt „lokal, kostenlos“) |
| `dingelschwing_agent_run_errors_total` | counter | Läufe mit Fehler |

### Mobiles BLE-Gateway (`mobile-server/`, `GET :8791/metrics`)

| Metrik | Typ | Bedeutung |
|---|---|---|
| `dingelschwing_gateway_uptime_seconds` | gauge | Laufzeit |
| `dingelschwing_gateway_auth_requests` | counter | angeforderte Authentifizierungen |
| `dingelschwing_gateway_grants` / `_denies` | counter | gewährte / abgelehnte Zugriffe |
| `dingelschwing_gateway_failed_macs` | counter | Entschlüsselungs-/Antwortfehler (Brute-Force-Indikator) |
| `dingelschwing_gateway_agent_proof_failures` | counter | **abgelehnte Agent-Nachweise** (unbekannter/falsch signierter Agent) |
| `dingelschwing_gateway_agent_proof_enforced` | gauge | 1 wenn `agent_proof` zwingend geprüft wird |
| `dingelschwing_gateway_suspended_agents` | gauge | aktuell suspendierte Agenten |
| `dingelschwing_gateway_ble_writes` / `_ble_notify` | counter | GATT-Schreibvorgänge / Notify-Updates |
| `dingelschwing_gateway_tamper_events` | counter | gemeldete Gehäuseöffnungen |
| `dingelschwing_gateway_scans` | counter | durchgeführte BLE-Scans |
| `dingelschwing_gateway_tokens_seen` | gauge | unterschiedlich gesehene Token |
| `dingelschwing_gateway_whitelist_size` | gauge | Whitelist-Größe |
| `dingelschwing_gateway_open_challenges` | gauge | offene Challenges (TTL 20 s, aktiv bereinigt) |
| `dingelschwing_gateway_ble_advertising` | gauge | 1 wenn BLE-Werbung läuft |

### NEXUS-Backend (`:5000/metrics`)
`up`, `http_requests_total{status,route}`, Latenz-Histogramme, plus Trace-Ketten-Label `trace_id` in den JSON-Logs (Loki).

## 2️⃣ Live-Statusleiste in der App

`src/lib/liveMetrics.ts` sammelt pro Lauf: Startzeit, Tokens, Kosten, Cache-Treffer,
genutzte Werkzeuge. Über dem Chat-Eingabefeld erscheint:

```
[🟢 Live] Zeit: 12s | Tokens: 1.234 | Kosten: $0.012 | Cache: 87%
```

Aggregat alle 2 s; Läufe werden zusätzlich an die Bridge gepostet (`POST /mcp/metrics/run`),
damit Browser-Sitzung und Prometheus dieselben Werte sehen. Ist die Bridge offline, bleibt die
Leiste lokal korrekt (kein Fehler, nur kein Upload). Die Desktop-Konsole nutzt dieselbe
8-s-Cache-Logik und antwortet auf `dashboard` mit `🟢 Läufe n | Ø ms | Tokens | Kosten | Cache n Einträge`.

**Messwerte je Lauf:** `ms` (Engine-Zeit), `tokens` (4 Zeichen ≈ 1 Token, bei lokalem Modell
geschätzt), `cost_usd` (0 bei lokalen Modellen), `cache_hit` (8-s-TTL identischer Tool-Aufruf),
`tools` (Skill-/Tool-Namen als Zähler).

## 3️⃣ Promtail: JSON-Logs strukturiert erschließen

Die App-Logs sind JSON-Zeilen mit `trace_id`, `step`, `route`, `status`, `role`. Promtail zerlegt
sie im Job `docker` mit `stage.json` + `stage.labels`, damit in Grafana/Explore gilt:

```logql
{job="docker"} | json | trace_id=~".+" | line_format "{{.step}} → {{.route}} status={{.status}}"
```

Ein Trace (Login → Geräte-Bindung → Pairing → Audit) lässt sich so über `trace_id` filtern –
die Kette, die `tests/chain.py` verifiziert.

Das Gateway schreibt zusätzlich `mobile-server/data/gateway_audit.jsonl`; der Job `gateway-audit`
liest dieselbe Datei (Read-only-Mount) und zieht `action` + `zone` als Labels, `ts` als Zeitstempel:

```logql
{job="gateway-audit"} |= "denied" | json | line_format "{{.action}} {{.token_id}} {{.reason}}"
{job="gateway-audit", action="tamper_detected"}
```

Läuft das Gateway auf einem separaten Rechner, `DGS_GATEWAY_DATA` im `.env` auf das Verzeichnis
setzen, dorthin das JSONL syncen (`rsync -a --append`) oder den Job auf einen
`loki_push_api`-Endpunkt umstellen.

## 4️⃣ Grafana-Abfragen (nützlichste)

```promql
# Ø Tool-Latenz (ms) über 5 min
rate(dingelschwing_mcp_call_duration_ms_sum[5m]) / rate(dingelschwing_mcp_calls_total[5m])

# Cache-Trefferquote als Prozent
100 * dingelschwing_mcp_cache_hit_ratio

# Ø Agent-Laufzeit in Sekunden
rate(dingelschwing_agent_run_duration_ms_sum[5m]) / 1000 / rate(dingelschwing_agent_runs_total[5m])

# Ablehnungsquote am Gate (Sicherheit!) – >3 % ist auffällig
rate(dingelschwing_gateway_denies[5m]) / rate(dingelschwing_gateway_auth_requests[5m])

# Unbekannte/falsch signierte Agenten in 5 min
rate(dingelschwing_gateway_agent_proof_failures[5m]) * 300

# Tokens pro Minute (Kosten-Kontrolle bei API-Modellen)
rate(dingelschwing_agent_tokens_total[1m]) * 60
```

Die Panels sind bereits im Dashboard hinterlegt (Zeile „MCP & mobiles BLE-Gateway“:
MCP-Tools, MCP-Verbunden, Grants/Denies, offene Challenges, Whitelist-Größe, BLE-Werbung,
Tamper, Agent-Zeit/Kosten, Token/Cache, Gateway-Logs). Nach Änderungen am JSON neu laden:
Grafana → Dashboards → *Reload* (Datei wird per Provisioning überwacht).

## 5️⃣ Traces (optional, nicht im Stack enthalten)

`docker-compose.monitoring.yml` und `datasources.yml` kennen **kein** Tempo (bewusst: offline-first,
und die Trace-Kette steckt schon als `trace_id` im Log). Wer OTLP-Spans ergänzen will:

```yaml
  tempo:
    image: grafana/tempo:2.4.1
    command: ["-config.file=/etc/tempo/tempo.yml"]
    volumes: [./tempo/tempo.yml:/etc/tempo/tempo.yml:ro]
    ports: ["3200:3200", "4317:4317"]
```

und in `datasources.yml` einen Eintrag `type: tempo, url: http://tempo:3200` hinzufügen.
Instrumentiert wird dann die Bridge (`mcp/bridge.mjs`) und das Gateway
(`mobile-server/gateway.py`), der vorhandene `trace_id` wird als Span-Attribute übernommen.

## 6️⃣ Verifikation

```bash
curl -s localhost:9090/api/v1/targets | jq -r '.data.activeTargets[] | "\(.labels.job) \(.health)"'
curl -s localhost:8790/metrics | head -20          # Bridge-Metriken
curl -s localhost:8791/metrics | grep gateway       # Gateway-Metriken
curl -s localhost:8791/status | jq '.agent_auth'    # Nachweis-Modus + Suspensionen
docker compose exec promtail wget -qO- localhost:3100/ready
```

Erwartet: `mcp-bridge 200` und `mobile-gateway 200`, 31 Tools, `agent_proof_enforced` 0 oder 1
(je nach Startargument), keine `5xx` im Backend. Ohne laufenden Host-Dienst zeigt der jeweilige
Target-Status `DOWN` – das ist der Alarmfall `McpBridgeDown`/`MobileGatewayDown`, kein
Konfigurationsfehler.

```bash
# Alert-Regeln gegen eine lokale Prometheus-Kopie prüfen (ohne Container)
docker compose -f deploy/monitoring/docker-compose.monitoring.yml exec prometheus \
  promtool check config /etc/prometheus/prometheus.yml
docker compose -f deploy/monitoring/docker-compose.monitoring.yml logs promtail | tail -20
```
