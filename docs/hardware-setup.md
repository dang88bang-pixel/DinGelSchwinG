# Hardware-Setup — Dongles, PTY-Bridge, SSH & BLE

Konkrete Anleitung zum Produktivmachen der Hardware-Pfade, die in der
README-Checkliste als Platzhalter markiert sind (`cat`-PTY-Bridge, SSH-Key-Pfade,
`bluetoothctl`-Voraussetzungen, `/dev/ttyACM*`).

> **Scope-Hinweis:** Der eigentliche Server-Code (PTY-Bridge, Scanner, Auth)
> ist nicht Teil dieses Repos — diese Anleitung beschreibt den produktiven
> Betrieb gemäß der Architektur in der [README](../README.md) (Ports 5000 /
> 8765–8767). Dieses Repo enthält die Clients (Web-App/APK, Desktop-Konsole).

---

## 1. Unterstützte USB-C-Dongles (VID/PID-Whitelist)

Die Interlock-Whitelist (Client: `runSafetyInterlockCheck`, Server: `pty_bridge`)
akzeptiert aktuell — strikt-by-default ohne erkannte VID:

| VID | PID (Bsp.) | Gerät | Zweck |
|-----|-----------|-------|-------|
| `0x2341` | `0x0043` / `0x0001` | Arduino Uno/Mega (USB-Serial) | UART-Bridge / Sensorstrecke |
| `0x16c0` | `0x05dc` | Van Ooijen Technische / V-USB-Stacks (z. B. USBasp, DigiSpark) | Prototyping-Dongle |
| `0x1a86` | `0x7523` | CH340/CH341 USB-Serial | Günstige UART-Dongles (⚠️ erst nach Freigabe in die Whitelist) |
| `0x0403` | `0x6001` | FTDI FT232 | Industrielle UART-Bridges (⚠️ erst nach Freigabe) |
| `0x1915` | `0x521F` | Nordic nRF52840 USB-C Dongle | BLE Professional Suite (Scan/GATT/Mesh/Sniffer) |
| `0x0A12` | `0x0001` | CSR 8510 BLE-Dongle | BLE-Erkennung (klassisch + LE) |

- **Whitelist erweitern:** VID sowohl clientseitig in `runSafetyInterlockCheck()`
  als auch serverseitig in der Bridge pflegen — beide Listen müssen deckungsgleich
  sein (single source of truth bleibt der Server).
- **Auf dem Host auflisten:**
  ```bash
  lsusb                      # VID:PID aller USB-Geräte anzeigen
  ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null   # serielle Endpunkte
  cat /sys/class/tty/ttyACM0/device/uevent | grep PRODUCT=   # VID/PID eines Ports
  ```

## 2. Host-Voraussetzungen (Linux)

```bash
# serielle Rechte ohne root (einmalig, danach neu anmelden)
sudo usermod -aG dialout $USER

# udev-Regel: stabiler Gerätename + Gruppenrechte (Bsp. Arduino VID 2341)
cat <<'EOF' | sudo tee /etc/udev/rules.d/99-dingelschwing.rules
SUBSYSTEM=="tty", ATTRS{idVendor}=="2341", GROUP="dialout", MODE="0660", SYMLINK+="dingelschwing/%k"
EOF
sudo udevadm control --reload && sudo udevadm trigger
```

**Docker:** Host-Devices an den Bridge-Container durchreichen:

```yaml
services:
  pty_bridge:
    devices:
      - "/dev/ttyACM0:/dev/ttyACM0"
    # für mDNS/BLE zwingend:
    network_mode: host
```

> Scanner nutzt `network_mode: host` (mDNS/BLE) — Port-Konflikt mit einem
> Host-Dienst auf 8766 prüfen.

## 3. PTY-Bridge: `cat`-Platzhalter ersetzen

Die Entwicklungs-Stub-Bridge spawnt `cat` (Echo). Produktiv je nach Ziel:

**a) Serielle Bridge (physisches Dongle an `/dev/ttyACM0`):**

```python
# Ausschnitt: _open_pty_session() in pty_bridge.py ersetzen
import serial  # pyserial 3.5

def _open_serial_session(port="/dev/ttyACM0", baud=115200):
    return serial.Serial(port=port, baudrate=baud, timeout=1)
# Reader-Thread: ser.read(...) -> WS; Writer: WS -> ser.write(...)
```

**b) Netzwerk-Brücke ohne Hardware (socat-PTY, für Remote-Targets):**

```bash
# virtuellen seriellen Port auf TCP mappen (Bridge-Host)
socat -d -d PTY,link=/tmp/vtty0,raw,echo=0 TCP:geraet.internal:23
```

**c) SSH-Ziel (paramiko, s. README-Verbindungsmatrix):**

```python
import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.RejectPolicy())   # known_hosts erzwingen!
ssh.connect(host, username=svc_user,
            key_filename=os.environ["DINGELSCHWING_SSH_KEY"])
chan = ssh.invoke_shell(term="xterm-256color")
```

## 4. SSH-Keys produktiv setzen

```bash
# eigenen Key für den Bridge-Service (kein im Image eingebettetes Secret!)
ssh-keygen -t ed25519 -a 100 -f /etc/dingelschwing/bridge_ed25519 -C "bridge@dingelschwing"
ssh-copy-id -i /etc/dingelschwing/bridge_ed25519.pub svc_user@netzwerkgeraet

export DINGELSCHWING_SSH_KEY=/etc/dingelschwing/bridge_ed25519
```

| Regel | Umsetzung |
|---|---|
| Kein Passwort im Log | Audit enthält nur Session-ID/Rolle (README §4) |
| Host-Keys pinnen | `RejectPolicy` + gepflegte `known_hosts` |
| Key-Rotation | `authorized_keys` auf Zielgeräten versionieren, alte Keys sperren |
| Rechte | Service-Account `svc_user` auf Zielgerät mit minimaler Shell |

Fehlt der Key, muss die Session mit `TERMINAL_SESSION_REJECTED` abgelehnt
werden — ohne Geheimnis-Details im Log (siehe Checkliste README §5).

## 5. BLE-Scan (Linux-Host)

`bluetoothctl`-Scan über USB-BLE-Dongle (Host-Netz nötig — Docker ohne
`network_mode: host` sieht kein hci-Interface):

```bash
# Voraussetzungen
apt install bluez          # bluetoothctl, btmgmt
btmgmt info                # Controller vorhanden? (hci0)
bluetoothctl power on
bluetoothctl scan le       # oder: scan on

# im Container sichtbar machen (Alternative zu network_mode: host)
docker run --net=host --cap-add=NET_ADMIN -v /var/run/dbus:/var/run/dbus ...
```

- Gemessene RSSI-Werte liefert das README-Konzept als `signal.rssi` pro Node;
  Auslesung über die Dongle-Charakteristik ergänzen (produktions-checkliste).
- **NTag/NFC** läuft bewusst clientseitig (WebNFC im Browser/Android) — kein
  Host-Bluetooth nötig.

## 6. Verifikations-Checkliste

- [ ] `lsusb` zeigt Dongle, VID in Whitelist (Client **und** Server)
- [ ] `udev` liefert stabilen `/dev/dingelschwing/ttyACM0`-Symlink
- [ ] Bridge-Health: `curl -s https://host:8765/...` bzw. WS-Handshake über Proxy
- [ ] SSH: Login mit Service-Key ohne Passwort, `known_hosts` gepinnt
- [ ] BLE: `bluetoothctl scan le` liefert Beacons auf dem Host
- [ ] Interlock-Test: nicht-gewhitelistetes Gerät → `DONGLE_MISSING`
