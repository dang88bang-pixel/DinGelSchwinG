# Store-Compliance — Prüferhinweise für NEXUS Manager

Dieses Dokument richtet sich an das Einreichungs-Team (Google Play / Apple App
Store) und an Reviewer. Es beschreibt **bestimmungsgemäße Nutzung**,
Berechtigungen und Maßnahmen, die eine Ablehnung wegen „Hacking“-Verdacht
vermeiden.

Die Funktionalität bleibt unverändert. Geändert ist ausschließlich die
**Positionierung**: Verwaltung, Diagnose und Wartung autorisierter Geräte —
kein Angriffswerkzeug.

Vollständige Store-Texte: [`store-listing.md`](./store-listing.md).

---

## 1. Bestimmungsgemäße Nutzung (Intended Use)

NEXUS Manager ist ein **Enterprise-Werkzeug für autorisierte IT-Mitarbeiter**.

| Erlaubt | Nicht vorgesehen |
|---|---|
| Verwaltung eigener / beauftragter Geräte | Zugriff auf fremde Geräte ohne Auftrag |
| Diagnose, Inventur, Backup, Datenrettung | Vorgefertigte Exploits oder Payloads |
| SSH/Serial/ADB auf freigegebenen Hosts | Anleitungen zu unbefugtem Zugriff |
| Integritäts- und Berechtigungsprüfung | Game Cheats, Cracks, Jailbreak-Anleitungen |
| Audit-Log für Compliance (ISO 27001) | Malware-Scanner / Virenschutz-Werbung |

Die App ist **nur in einer eigenen IT-Umgebung** (typisch hinter einer Firewall,
mit VID/PID-Whitelist und RBAC) sinnvoll einsetzbar.

---

## 2. Verbotene Begriffe (Checkliste vor Einreichung)

In Store-Text, Screenshots, In-App-Überschriften und Release Notes **nicht**
verwenden:

`pentest`, `penetration`, `hack`, `hacking`, `HackGPT`, `exploit`,
`vulnerability`, `crack`, `cheat`, `jailbreak`, `rootkit`, `malware`,
`payload` (außer als technischer JSON-Begriff intern), `unbefugter Zugriff`,
`Angriff`, `NEXUS-BUILDER` als Marketingname.

Stattdessen:

| Alt (riskant) | Neu (store-sicher) |
|---|---|
| Penetrationstest / Hacking | Sicherheitsüberwachung / Integritätsprüfung |
| Sicherheitslücke ausnutzen | Schwachstellenanalyse intern → **Systemhärtung / Compliance-Check** |
| Unbefugter Zugriff | Autorisierte Fernwartung |
| HackGPT | KI-Assistenz für Administratoren |
| Game Cheats | *(nicht erwähnen)* |
| NEXUS-BUILDER | NEXUS Manager |

---

## 3. Berechtigungen und Begründung

Die Angaben in der Store-Konsole müssen mit dem Manifest und der Beschreibung
übereinstimmen.

| Berechtigung | Warum (Store-Text) |
|---|---|
| `INTERNET` | Verbindung zur eigenen Verwaltungs-Backend-API (Login, Geräte-Status, Audit). Kein Tracking Dritter. |
| USB / serielle Geräte (Host-Bridge) | Konfiguration und Diagnose freigegebener USB-C-Dongles gemäß VID/PID-Whitelist. |
| Bluetooth (optional, Host) | Erkennung verwalteter BLE-Tokens in der eigenen Infrastruktur. |
| NFC (optional, Client) | Auslesen firmeneigener NTag-Tracker zur Inventur. |
| Bewegungssensoren (optional) | 3D-Lageanzeige gekoppelter Geräte in der Leitwarte. |

Aktuelles Android-Manifest deklariert `INTERNET`. Weitere Rechte nur hinzufügen,
wenn die jeweilige Funktion im eingereichten Build wirklich aktiv ist — und
dann hier plus Store-Formular nachziehen.

---

## 4. Was Reviewer in der App sehen sollen

1. **Launcher-Name:** NEXUS Manager
2. **Startbildschirm:** Geräteübersicht / Leitwarte, keine „Hack“-Begriffe
3. **Agent Console:** Administrations-Chat mit Freigabeprozess für riskante Aktionen
4. **Rollenmodell:** guest → operator → service → developer → expert → emergency
5. **Kritische Aktionen:** Bestätigungsdialog + optional FIDO2/WebAuthn
6. **Audit-Log:** nachvollziehbare Arbeitsschritte

Es gibt keine versteckten Funktionen, keine Easter Eggs und keine mitgelieferten
Exploit-Datenbanken.

---

## 5. Testdaten für die Store-Prüfung

Bitte im Play Console-Feld *App access* / App-Review-Notizen hinterlegen:

```
Demo-Zugang (kontrollierte Laborumgebung):
  Benutzer: reviewer@example.com
  Passwort: [im Review-Formular eintragen, nicht ins Repo]

Hinweis an Prüfer:
  Die App verwaltet ausschließlich Geräte, die der angemeldete Administrator
  zuvor gebunden hat. Ohne gebundenes Laborgerät bleiben Diagnoseaktionen
  inaktiv bzw. werden durch das Rollenmodell abgelehnt (HTTP 403 / RBAC_DENIED).
  Shell-/ADB-Aktionen erfordern eine ausdrückliche Freigabe („freigeben“)
  und wirken nur auf autorisierte, per USB/SSH erreichbare eigene Geräte.
```

Desktop-Konsole (nicht Teil des Mobile-Store-Builds): Demo-Login `admin` / Rolle
`admin` — nur für interne QA, nicht als Store-Review-Zugang bewerben.

---

## 6. App-Store-spezifische Checks

### Google Play

- Kategorie: Business / Productivity (nicht „Security“ als Virenschutz)
- Data safety: Login-Daten, Geräte-IDs, Audit-Ereignisse — Zweck
  „App-Funktionalität“, keine Werbung, keine Drittverkauf
- Pre-launch report vor der Einreichung ausführen
- Keine Werbe-SDKs, kein Tracking über die eigene Infrastruktur hinaus

### Apple App Store

- Kategorie: Business / Developer Tools
- Keine Erwähnung von Malware-Scanner oder Virenschutz
- Export Compliance: HTTPS/TLS für Backend; keine eigene Krypto jenseits
  der Plattform-APIs (Standard-TLS + WebAuthn)
- Review-Notizen: „Enterprise device administration for authorized staff only“

---

## 7. Funktionale Leitplanken (unverändert, aber prüfbar)

- Keine vorgefertigten Exploits im ausgelieferten Build
- Beliebige Shell-Befehle nur hinter RBAC (Developer/Expert/Emergency) und
  nach expliziter Freigabe
- VID/PID-Interlock: unbekannte USB-Geräte werden abgelehnt
- Debug-/Test-Codes nicht im Release-Build belassen
- Interne Legacy-Aliase (z. B. das Wort „pentest“ als versteckter Chat-Trigger)
  werden **nicht** in der Hilfe, den Skills oder der Store-Beschreibung genannt

---

## 8. Screenshot-Beschriftungen (Vorlage)

1. Leitwarte — verbundene Clients und Geräte im Überblick
2. Gerätebindung — USB, BLE, NFC, Wi-Fi für autorisierte Peripherie
3. Agent Console — wiederkehrende Wartungsaufgaben per Chat
4. Rollen & Freigaben — kritische Aktionen nur nach Bestätigung
5. Audit-Log — nachvollziehbare Administrationsschritte
