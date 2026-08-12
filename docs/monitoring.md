# Monitoring-Stack (Loki · Prometheus · Grafana · Slack-Alerting)

Mitgelieferter, erweiterbarer Stack unter [`deploy/monitoring/`](../deploy/monitoring/).
Bildet die README-Konzepte (strukturierte JSON-Logs → Loki, Metriken → Prometheus,
Alerting → Slack) als lauffähige Konfiguration ab.

## Schnellstart

```bash
cp deploy/.env.example deploy/.env   # SLACK_WEBHOOK_URL + GRAFANA_ADMIN_PASSWORD setzen
set -a; . deploy/.env; set +a
docker compose --env-file deploy/.env \
  -f deploy/monitoring/docker-compose.monitoring.yml up -d
```

| Dienst | Port | Zweck |
|---|---|---|
| Grafana | 3000 | Dashboards (Admin-Passwort aus `.env`) |
| Prometheus | 9090 | Metriken, 30 d Retention, Alert-Rules |
| Alertmanager | 9093 | Slack-Benachrichtigungen |
| Loki | 3100 | Log-Speicher (30 d) |
| Promtail | 9080 | Sammelt Container-JSON-Logs |

## Was vorkonfiguriert ist

- **Alerts** (`prometheus/alert-rules.yml`): `BackendDown` (1 min),
  `Http5xxRate` (>2 % über 5 min), `BruteForceLoginAttempts` (429er des
  Rate-Limiters aus README §11).
- **Slack-Route** (`alertmanager/alertmanager.yml`): Channel `#nexus-alerts`,
  `SLACK_WEBHOOK_URL` per ENV eingeblendet.
- **Grafana** auto-provisioned: Datasources (Prometheus + Loki) und das
  Dashboard **„NEXUS – Übersicht“** (Backend-up, Requests/s, Error-Logs mit
  `trace_id`-Filter).
- **Promtail** labelt strukturierte Log-Felder (`trace_id`, `session_id`,
  `level`) — die Audit-/trace-Ketten aus der README werden abfragbar:
  ```logql
  {trace_id="8f3a…"} | json
  ```

## Voraussetzung an der App

| Erwartung | Umsetzung im Server (extern) |
|---|---|
| `GET /api/metrics` (Prometheus-Format) | z. B. `prometheus-flask-exporter` im Flask-Auth-Service |
| JSON-Logs auf stdout | bereits README-Konvention (session_id/trace_id) |
| Log-Felder `level`, `trace_id` | von der Pipeline gelabelt |

## Erweitern

- Neuer Service? → `prometheus.yml` `scrape_configs` ergänzen.
- Neuer Alert? → `alert-rules.yml`, Slack-Routing bleibt.
- SaaS statt self-hosted: Datasources in `provisioning/datasources/`
  auf Grafana-Cloud-Endpunkte zeigen lassen (Token per ENV).
