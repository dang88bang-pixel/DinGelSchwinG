"""DinGelSchwinG · USB-Herstellerzuordnung und schreibgeschützte Geräte-Vorabprüfung.

Zwei Dinge, die im Feld ständig gebraucht werden und keine Privilegien brauchen:

1. **Hersteller zu VID/PID.** `adb devices -l` und `lsusb` liefern Zahlen
   (`18d1:4e12`), kein Mensch kann sich die merken. Eingebaut ist eine kuratierte
   Kern-Tabelle (`data/usb_vendors.json`, belegt aus der Android-Doku und
   Community-Regelwerken). Wer die *vollständige* Zuordnung will, lässt dem Gateway
   eine `usb.ids` da (Pfad via `DGS_USB_IDS`); die gewinnt dann gegen die Kurzfassung.
   Gern gelesen werden außerdem `51-android.rules` und `~/.android/adb_usb.ini`.

2. **Vorabprüfung ("Brickschutz").** Ein Bericht *vor* jedem Eingriff: Akkustand,
   Bootloader-/Verified-Boot-Zustand, Security-Patch-Alter, Modellübereinstimmung,
   SHA-256 des Images gegen Begleitdatei, Backup-Alter. Alles ausschließlich
   `getprop` / `dumpsys battery` / `sha256sum` – es wird nichts geschrieben, kein
   Partition angefasst, kein Unlock versucht. Das Flashen selbst bleibt Sache der
   Wartungsstation mit OEM-Werkzeug und Protokoll.

Bewusst **nicht** implementiert (auch nicht auf Zuruf): FRP-Umgehung, IMEI-Änderung,
Bootloader-Unlock-Automatik, ChimeraTool-Nachbau. Gerät sperren und Geräte-
Identifikation verändern sind Sicherheitseinrichtungen, keine Funktionen.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable, Sequence

HERE = Path(__file__).resolve().parent
BUNDLED = HERE / "data" / "usb_vendors.json"

USB_IDS_CANDIDATES = (
    "/usr/share/hwdata/usb.ids",
    "/usr/share/misc/usb.ids",
    "/usr/local/share/hwdata/usb.ids",
)
UDEV_RULE_CANDIDATES = (
    "/etc/udev/rules.d/51-android.rules",
    "/usr/lib/udev/rules.d/51-android.rules",
    "/lib/udev/rules.d/51-android.rules",
)
ADB_INI_CANDIDATES = ("~/.android/adb_usb.ini",)

KIND_LABEL = {
    "android_oem": "Android-OEM",
    "eda": "Mobile Computing / Erfassung",
    "soc": "SoC / Board",
    "host": "Host / Peripherie",
}

ADB_TIMEOUT = float(os.environ.get("DGS_ADB_TIMEOUT", "8"))

# ---------------------------------------------------------------------------
# normalization / parsers
# ---------------------------------------------------------------------------
_HEX4 = re.compile(r"^[0-9a-fA-F]{1,4}$")
_VID_IN_TEXT = re.compile(r"(?:0x)?([0-9a-fA-F]{4})\s*(?::\s*(?:0x)?([0-9a-fA-F]{1,4}))?")


def norm_id(raw: Any) -> str | None:
    """`0x18D1` / `18d1` / `18d1:4e12` / 6351 → `0x18d1` (PID, falls vorhanden, separat)."""
    if raw is None:
        return None
    if isinstance(raw, int):
        return f"0x{raw & 0xFFFF:04x}"
    text = str(raw).strip()
    if not text:
        return None
    m = _VID_IN_TEXT.match(text)
    if not m:
        return None
    return f"0x{m.group(1).lower()}"


def split_ids(raw: Any) -> tuple[str | None, str | None]:
    """Holt (vid, pid) aus `18d1:4e12`, `ID 18d1:4e11`, `vendor:18d1 product:4e12` …"""
    if raw is None:
        return None, None
    if isinstance(raw, int):
        return f"0x{(raw >> 16) & 0xFFFF:04x}", f"0x{raw & 0xFFFF:04x}"
    text = str(raw)
    hits = re.findall(r"(?:0x)?([0-9a-fA-F]{4})(?:\s*:\s*(?:0x)?([0-9a-fA-F]{1,4}))?", text)
    for vid, pid in hits:
        if vid and pid:
            return f"0x{vid.lower()}", f"0x{pid.lower()}"
        if vid:
            return f"0x{vid.lower()}", None
    return None, None


def parse_usb_ids(text: str) -> dict[str, str]:
    """usb.ids des Linux USB ID Repository: nur die Vendor-Zeilen (kein Einzug)."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        if not line or line.startswith("#") or line[0].isspace():
            continue
        m = re.match(r"^([0-9a-fA-F]{4})\s+(.+?)\s*$", line)
        if m:
            out[f"0x{m.group(1).lower()}"] = m.group(2)
    return out


def parse_udev_rules(text: str) -> dict[str, str]:
    """51-android.rules: `# Name` + `ATTR{idVendor}=="0c2e"` – Kommentar gehört zur Regel danach."""
    out: dict[str, str] = {}
    pending = ""
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            pending = stripped.lstrip("#").strip()
            continue
        m = re.search(r'idVendor\}?=="([0-9a-fA-F]{1,4})"', stripped)
        if m:
            vid = f"0x{m.group(1).lower()}"
            if pending and vid not in out:
                out[vid] = pending
            out.setdefault(vid, pending or "Unbekannt (udev-Regel)")
            pending = ""
    return out


def parse_adb_usb_ini(text: str) -> dict[str, str]:
    """`~/.android/adb_usb.ini`: eine VID pro Zeile (`0x18d1`), Kommentare mit `#`."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        vid = norm_id(stripped)
        if vid:
            out[vid] = ""
    return out


# ---------------------------------------------------------------------------
# store
# ---------------------------------------------------------------------------
class Store:
    """VID → Hersteller, geschichtet: built-in ← gefundene Host-Quellen ← usb.ids."""

    def __init__(self, vendors: dict[str, dict[str, Any]], sources: Sequence[str], meta: dict[str, Any] | None = None):
        self.vendors = vendors
        self.sources = list(sources)
        self.meta = meta or {}
        self.loaded_at = time.time()

    # --- lookups -----------------------------------------------------------
    def lookup(self, vid: Any) -> dict[str, Any] | None:
        key = norm_id(vid)
        if not key:
            return None
        found = self.vendors.get(key)
        return dict(found) if found else None

    def describe(self, vid: Any, pid: Any = None) -> dict[str, Any]:
        """Anzeigename plus Kontext – für UI, Audit-Eintrag und `adb`-Skripte."""
        key = norm_id(vid)
        pid_key = None
        pair = str(vid or "")
        if ":" in pair:
            _, pid_key = split_ids(pair)
        if pid is not None:
            pid_key = norm_id(pid) or pid_key
        entry = self.lookup(key) if key else None
        out: dict[str, Any] = {
            "vid": key,
            "pid": pid_key,
            "name": (entry or {}).get("name") or "Unbekannter Hersteller",
            "known": bool(entry),
            "kind": (entry or {}).get("kind") or "unbekannt",
            "kind_label": KIND_LABEL.get((entry or {}).get("kind") or "", "unbekannt"),
            "adb_capable": bool((entry or {}).get("adb")),
            "via": (entry or {}).get("via", "bundled" if entry else "—"),
        }
        if entry and entry.get("note"):
            out["note"] = entry["note"]
        return out

    def search(self, query: str, limit: int = 25) -> list[dict[str, Any]]:
        q = str(query or "").strip().lower()
        if not q:
            return []
        # "0x0c2e:0c2f" / "18d1:4e12" → erst ID-Suche, dann Name
        vid, pid = split_ids(q)
        out: list[dict[str, Any]] = []
        if vid:
            for key, entry in self.vendors.items():
                if key == vid:
                    row = dict(entry)
                    row["matched"] = "vid"
                    out.append(row)
                    if len(out) >= limit:
                        return out
        if pid:
            q = ""  # reine ID-Suche, Namen nicht zusätzlich matchen
        needle = q
        for key, entry in self.vendors.items():
            if len(out) >= limit:
                break
            if needle and (needle in str(entry.get("name", "")).lower() or needle in key):
                if any(o.get("vid") == key for o in out):
                    continue
                row = dict(entry)
                row["matched"] = "name" if needle in str(entry.get("name", "")).lower() else "vid"
                out.append(row)
        return out

    def as_dict(self) -> dict[str, Any]:
        rows = sorted(self.vendors.values(), key=lambda d: d.get("vid") or "")
        return {
            "ok": True,
            "count": len(rows),
            "sources": self.sources,
            "meta": self.meta,
            "vendors": [{k: v for k, v in r.items() if k != "via"} for r in rows],
        }


def _merge(target: dict[str, dict[str, Any]], mapping: dict[str, str], via: str, kind: str = "host") -> int:
    added = 0
    for vid, name in mapping.items():
        if not name:
            entry = target.setdefault(vid, {"vid": vid, "name": "Bekannt aus adb-Regelwerk (Name unbekannt)", "kind": kind, "adb": True, "via": via})
            added += 1 if entry.get("via") == via else 0
            if entry.get("via") != via:
                entry["also_in"] = via
            continue
        if vid in target:
            prev = target[vid]
            # usb.ids und Regelwerke dürfen sich unterscheiden – Host-Quelle gewinnt,
            # der built-in Name bleibt als Hinweis erhalten.
            if via != "bundled" and prev.get("via") == "bundled":
                target[vid] = {**prev, "name": name, "via": via, "bundled_name": prev.get("name")}
                added += 1
            continue
        target[vid] = {"vid": vid, "name": name, "kind": kind, "via": via}
        added += 1
    return added


def load(extra_paths: Sequence[str] | None = None) -> Store:
    """Kurztabelle + was der Host hergibt (usb.ids, udev-Regeln, adb_usb.ini)."""
    vendors: dict[str, dict[str, Any]] = {}
    sources: list[str] = []
    meta: dict[str, Any] = {}
    if BUNDLED.is_file():
        try:
            doc = json.loads(BUNDLED.read_text(encoding="utf-8"))
            for row in doc.get("vendors") or []:
                vid = norm_id(row.get("vid"))
                if not vid:
                    continue
                entry = dict(row)
                entry["vid"] = vid
                entry["via"] = "bundled"
                vendors[vid] = entry
            meta = dict(doc.get("_meta") or {})
            sources.append(str(BUNDLED))
        except (OSError, ValueError) as exc:
            meta["bundled_error"] = str(exc)[:160]

    candidates: list[str] = []
    if extra_paths:
        candidates.extend(str(p) for p in extra_paths)
    env_ids = os.environ.get("DGS_USB_IDS")
    if env_ids:
        candidates.append(env_ids)
    for path in candidates:
        p = Path(path).expanduser()
        if not p.is_file():
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if p.suffix == ".ini" or "adb_usb" in p.name:
            n = _merge(vendors, parse_adb_usb_ini(text), str(p), kind="android_oem")
        elif "rules" in p.name:
            n = _merge(vendors, parse_udev_rules(text), str(p), kind="android_oem")
        else:
            n = _merge(vendors, parse_usb_ids(text), str(p), kind="host")
        sources.append(f"{p} (+{n})")

    for path in USB_IDS_CANDIDATES + UDEV_RULE_CANDIDATES + ADB_INI_CANDIDATES:
        p = Path(path).expanduser()
        if not p.is_file() or str(p) in sources:
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if "rules" in p.name:
            _merge(vendors, parse_udev_rules(text), str(p), kind="android_oem")
        elif "adb_usb" in p.name:
            _merge(vendors, parse_adb_usb_ini(text), str(p), kind="android_oem")
        else:
            _merge(vendors, parse_usb_ids(text), str(p), kind="host")
        sources.append(str(p))

    meta.setdefault("count", len(vendors))
    return Store(vendors, sources, meta)


_CACHE: dict[tuple[str, ...], Store] = {}


def default_store(refresh: bool = False, paths: Sequence[str] | None = None) -> Store:
    """Gecachter Store; zusätzliche Pfade (z. B. cfg.usb_ids_file) erzeugen eigenen Cache-Eintrag."""
    key = tuple(str(x) for x in (paths or ()))
    if refresh or key not in _CACHE:
        _CACHE[key] = load(paths)
    return _CACHE[key]


# ---------------------------------------------------------------------------
# adb-Auswertung
# ---------------------------------------------------------------------------
def parse_adb_devices(text: str) -> list[dict[str, Any]]:
    """`adb devices -l` → Strukturliste. Zeilenform:

    `R58M60ABCAA  device product:a5xsa model:SM_A515F device:a51 transport_id:2`
    """
    out: list[dict[str, Any]] = []
    for line in (text or "").splitlines():
        stripped = line.strip()
        if not stripped or stripped.lower().startswith("list of devices") or stripped.startswith("*"):
            continue
        parts = stripped.split()
        if len(parts) < 2:
            continue
        serial, state = parts[0], parts[1]
        row: dict[str, Any] = {"serial": serial, "state": state}
        for token in parts[2:]:
            if ":" not in token:
                continue
            key, _, value = token.partition(":")
            if key in ("product", "model", "device", "transport_id"):
                row[key] = value.replace("_", " ") if key == "model" else value
        if ":" not in serial:
            row.setdefault("transport", "usb")
        else:
            row["transport"] = "network"
            row["host"] = serial.rsplit(":", 1)[0]
        out.append(row)
    return out


def parse_lsusb(text: str) -> list[dict[str, Any]]:
    """`lsusb` → `ID 18d1:4e11 Google Inc. Nexus One` (eine Zeile pro Gerät)."""
    out: list[dict[str, Any]] = []
    for line in (text or "").splitlines():
        m = re.search(r"Bus\s+(\d+)\s+Device\s+(\d+):\s+ID\s+([0-9a-fA-F]{4}):([0-9a-fA-F]{4})\s*(.*)$", line.strip())
        if not m:
            continue
        out.append({
            "bus": m.group(1),
            "device": m.group(2),
            "vid": f"0x{m.group(3).lower()}",
            "pid": f"0x{m.group(4).lower()}",
            "name": m.group(5).strip(),
        })
    return out


def adb_binary() -> str | None:
    return shutil.which(os.environ.get("DGS_ADB_BIN") or "adb")


def run_lsusb(timeout: float = ADB_TIMEOUT) -> dict[str, Any]:
    """`lsusb -d`-freie Kurzfassung: nur die Geräteliste, um Hersteller zu benennen."""
    exe = shutil.which("lsusb")
    if not exe:
        return {"ok": False, "error": "lsusb_nicht_verfuegbar", "hint": "paket usbutils installieren"}
    try:
        proc = subprocess.run([exe], capture_output=True, text=True, timeout=timeout, check=False)
    except (subprocess.TimeoutExpired, OSError) as exc:
        return {"ok": False, "error": "lsusb_fehlgeschlagen", "detail": str(exc)[:120]}
    return {"ok": proc.returncode == 0, "stdout": (proc.stdout or "").strip(), "command": exe}


def usb_devices(store: Store, *, lsusb_text: str | None = None) -> dict[str, Any]:
    """Alle USB-Geräte des Hosts mit Hersteller-Namen (read-only, für „Anbindungen“)."""
    if lsusb_text is None:
        res = run_lsusb()
        if not res.get("ok") and res.get("error"):
            return {"ok": False, "error": res["error"], "hint": res.get("hint", ""), "devices": []}
        lsusb_text = res.get("stdout") or ""
    rows = []
    for item in parse_lsusb(lsusb_text):
        info = store.describe(item["vid"], item.get("pid"))
        rows.append({**item, "manufacturer": info["name"], "known": info["known"], "kind": info["kind"],
                     "note": info.get("note", "")})
    return {"ok": True, "devices": rows, "count": len(rows)}


def run_adb(args: Sequence[str], timeout: float = ADB_TIMEOUT, adb: str | None = None) -> dict[str, Any]:
    """adb aufrufen – kein shell=True, feste Argumentliste, kurzes Timeout."""
    exe = adb or adb_binary()
    if not exe:
        return {"ok": False, "error": "adb_nicht_verfuegbar",
                "hint": "platform-tools installieren oder DGS_ADB_BIN setzen", "args": list(args)}
    try:
        proc = subprocess.run([exe, *args], capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout", "args": list(args), "timeout_s": timeout}
    except OSError as exc:
        return {"ok": False, "error": "adb_fehlgeschlagen", "detail": str(exc)[:160], "args": list(args)}
    return {
        "ok": proc.returncode == 0,
        "code": proc.returncode,
        "stdout": (proc.stdout or "").strip(),
        "stderr": (proc.stderr or "").strip(),
        "args": list(args),
        "command": " ".join([exe, *[str(a) for a in args]]),
    }


def _getprop(adb: str | None, serial: str, key: str) -> str:
    res = run_adb(["-s", serial, "shell", "getprop", key], adb=adb)
    if not res.get("ok"):
        return ""
    return str(res.get("stdout") or "").strip()


def device_snapshot(store: Store, serial: str, *, props: dict[str, str] | None = None, adb: str | None = None) -> dict[str, Any]:
    """Nur-Lesen-Steckbrief eines Geräts (Vorlage für die Checkliste)."""
    keys = ("ro.product.manufacturer", "ro.product.model", "ro.build.version.release",
            "ro.build.version.security_patch", "ro.boot.verifiedbootstate",
            "ro.boot.flash.locked", "ro.boot.Bootloader", "ro.serialno")
    values = dict(props) if props is not None else {k: _getprop(adb, serial, k) for k in keys}
    if props is None:
        battery = run_adb(["-s", serial, "shell", "dumpsys", "battery"], adb=adb)
        level = None
        if battery.get("ok"):
            m = re.search(r"^\s*level:\s*(\d+)", battery.get("stdout") or "", re.M)
            if m:
                level = int(m.group(1))
        values["__battery_level"] = "" if level is None else str(level)
    return {"serial": serial, "props": values}


# ---------------------------------------------------------------------------
# Vorabprüfung ("Brickschutz")
# ---------------------------------------------------------------------------
PATCH_WARN_DAYS = 400
BACKUP_FRESH_DAYS = 30
IMAGES_ENV = "DGS_IMAGE_DIR"


def _check(cid: str, label: str, status: str, detail: str, *, command: str = "", fix: str = "") -> dict[str, str]:
    row = {"id": cid, "label": label, "status": status, "detail": detail}
    if command:
        row["command"] = command
    if fix:
        row["fix"] = fix
    return row


def images_root(explicit: str | None = None) -> Path:
    return Path(explicit or os.environ.get(IMAGES_ENV) or (HERE / "data" / "images")).expanduser()


def resolve_image(name: str, root: Path) -> tuple[Path | None, str | None]:
    """Bildpfad innerhalb des freigegebenen Ordners – kein Pfad nach außen."""
    if not name:
        return None, None
    candidate = (root / name).resolve()
    try:
        root_res = root.resolve()
    except OSError:
        return None, "ordner_nicht_gefunden"
    if root_res not in candidate.parents and candidate != root_res:
        return None, "pfad_nicht_erlaubt"
    if not candidate.is_file():
        return None, "datei_nicht_gefunden"
    return candidate, None


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    digest = sha256()
    with path.open("rb") as handle:
        while True:
            block = handle.read(chunk)
            if not block:
                break
            digest.update(block)
    return digest.hexdigest()


def read_sidecar(path: Path) -> str:
    """`.sha256`-Begleiter lesen (`<hash>  <name>` oder nur Hash)."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""
    m = re.search(r"\b([0-9a-fA-F]{64})\b", text or "")
    return m.group(1).lower() if m else ""


def _days_since(value: str) -> int | None:
    for fmt in ("%Y-%m-%d",):
        try:
            return int((time.time() - time.mktime(time.strptime(value, fmt))) // 86400)
        except ValueError:
            continue
    return None


def preflight(store: Store, *, devices: Sequence[dict[str, Any]] | None = None, serial: str = "",
              image: str = "", expected_model: str = "", backup_dir: str = "",
              images_dir: str = "", runner: Callable[[str], dict[str, Any]] | None = None,
              adb_path: str | None = None) -> dict[str, Any]:
    """Schreibgeschützter Vorabbericht. `runner` erlaubt Prüfung ohne adb (Tests/CI).

    Returns ``{ok, verdict, checks[], devices[], note}`` mit verdict
    ``ok | attention | blockiert``.
    """
    checks: list[dict[str, str]] = []
    exe = adb_path if adb_path is not None else adb_binary()
    list_res = {"ok": True, "stdout": ""} if devices is not None else run_adb(["devices", "-l"], adb=exe)
    if devices is None:
        if not list_res.get("ok") and list_res.get("error"):
            checks.append(_check(
                "adb", "adb verfügbar", "bad",
                f"adb-Aufruf fehlgeschlagen: {list_res.get('error')}",
                fix=str(list_res.get("hint") or "platform-tools installieren (Android SDK) oder DGS_ADB_BIN setzen"),
            ))
            return {"ok": False, "verdict": "blockiert", "checks": checks, "devices": [],
                    "note": "Ohne adb keine Vorabprüfung – Gerät an der Wartungsstation anschließen."}
        devices = parse_adb_devices(list_res.get("stdout") or "")

    live = [d for d in devices if d.get("state") == "device"]
    if not devices:
        checks.append(_check("geraete", "ADB-Geräte", "warn", "Kein Gerät gemeldet.",
                             command="adb devices -l", fix="USB-Debugging am Gerät einschalten, Kabel prüfen"))
    else:
        states = ", ".join(f"{d.get('serial')} ({d.get('state')})" for d in devices[:6])
        bad = [d for d in devices if d.get("state") not in ("device", "sideload", "recovery")]
        checks.append(_check(
            "geraete", "ADB-Geräte", "ok" if not bad else "warn",
            f"{len(devices)} gemeldet: {states}",
            command="adb devices -l",
            fix="" if not bad else "unauthorized = am Gerät bestätigen; offline = `adb kill-server && adb start-server`",
        ))

    named = []
    for dev in devices:
        row = dict(dev)
        info = store.describe(dev.get("vendor_id") or dev.get("serial") or "")
        named.append({**row, "manufacturer": info.get("name"), "manufacturer_known": info.get("known")})

    target: dict[str, Any] | None = None
    if serial:
        want = str(serial).strip().lower()
        target = next((d for d in devices if str(d.get("serial") or "").strip().lower() == want), None)
        if target is None:
            checks.append(_check("serial", "Zielgerät", "bad", f"{serial} nicht in der Geräteliste.",
                                 command="adb devices -l", fix="Seriennummer prüfen oder --serial weglassen"))
    elif len(devices) == 1:
        target = devices[0]
    elif len(devices) > 1:
        checks.append(_check("serial", "Zielgerät", "bad", "Mehrere Geräte angeschlossen.",
                             fix="--serial <seriennummer> angeben, sonst ist das Ziel raten"))

    snap: dict[str, Any] = {}
    if target is not None and (runner or exe):
        if runner is not None:
            snap = runner(str(target.get("serial"))) or {}
        else:
            snap = device_snapshot(store, str(target.get("serial")), adb=exe)
    props = dict(snap.get("props") or {})

    level_raw = props.get("__battery_level") or ""
    if level_raw.isdigit():
        level = int(level_raw)
        tone = "ok" if level >= 50 else ("warn" if level >= 20 else "bad")
        checks.append(_check("akku", "Akkustand", tone, f"{level} %",
                             command="adb shell dumpsys battery | grep level",
                             fix="" if tone == "ok" else "Unterbrechungsfrei laden – ein Flash-Vorgang darf nicht bei 12 % enden"))
    else:
        checks.append(_check("akku", "Akkustand", "info", "nicht lesbar (Gerät nicht bereit)",
                             command="adb shell dumpsys battery"))

    vb = (props.get("ro.boot.verifiedbootstate") or "").lower()
    locked = (props.get("ro.boot.flash.locked") or "").strip()
    if vb or locked:
        unlocked = vb == "orange" or locked == "0"
        checks.append(_check(
            "bootloader", "Bootloader / Verified Boot", "warn" if unlocked else "ok",
            (f"verifiedbootstate={vb or '?'}, flash.locked={locked or '?'} – entsperrt"
             if unlocked else f"verifiedbootstate={vb or 'green'}, flash.locked={locked or '1'} – gesperrt"),
            command="adb shell getprop ro.boot.verifiedbootstate; adb shell getprop ro.boot.flash.locked",
            fix="Entsperrter Bootloader: OEM-Garantie und Widevine-L1 typischerweise weg – vor dem Eingriff dokumentieren."
            if unlocked else "",
        ))
    else:
        checks.append(_check("bootloader", "Bootloader / Verified Boot", "info",
                             "keine Bootloader-Attribute lesbar (nicht jedes OEM gibt sie per getprop)",
                             command="adb shell getprop | grep -E 'verifiedbootstate|flash.locked'"))

    patch = props.get("ro.build.version.security_patch") or ""
    if patch:
        days = _days_since(patch)
        tone = "ok" if days is not None and days <= PATCH_WARN_DAYS else "warn"
        checks.append(_check("patch", "Security-Patch", tone, f"{patch} ({days} Tage)" if days is not None else patch,
                             command="adb shell getprop ro.build.version.security_patch",
                             fix="" if tone == "ok" else f"Älter als {PATCH_WARN_DAYS} Tage – nach dem Eingriff aktualisieren."))
    else:
        checks.append(_check("patch", "Security-Patch", "info", "nicht lesbar"))

    model = props.get("ro.product.model") or ""
    if expected_model:
        same = model.strip().lower() == expected_model.strip().lower()
        checks.append(_check("modell", "Modellübereinstimmung", "ok" if same else "bad",
                             f"Gerät meldet {model or '—'}, erwartet {expected_model}",
                             command="adb shell getprop ro.product.model",
                             fix="" if same else "Falsches Image – Abbruch. Ein Image für ein anderes Modell ist der klassische Brick."))
    elif model:
        checks.append(_check("modell", "Modell", "info", f"{model} · {props.get('ro.build.version.release') or ''} (Android)".strip(),
                             command="adb shell getprop ro.product.model"))

    root = images_root(images_dir or None)
    if image:
        path, err = resolve_image(image, root)
        if err:
            checks.append(_check("image", "Image-Datei", "bad", f"{image}: {err}",
                                 fix=f"Nur Dateien unter {root} sind prüfbar (DGS_IMAGE_DIR)."))
        else:
            assert path is not None
            actual = sha256_file(path)
            sidecar = read_sidecar(path.with_suffix(path.suffix + ".sha256"))
            size = path.stat().st_size
            if not sidecar:
                checks.append(_check("image", "Image-Prüfsumme", "warn",
                                     f"{path.name} · {size} B · sha256 {actual[:16]}…, keine .sha256-Datei",
                                     command=f"sha256sum {path.name}",
                                     fix="Begleitdatei `<name>.sha256` vom Anbieter mit ablegen, dann ist der Abgleich automatisch."))
            elif sidecar == actual:
                checks.append(_check("image", "Image-Prüfsumme", "ok", f"{path.name} · sha256 {actual[:16]}… stimmt",
                                     command=f"sha256sum -c {path.name}.sha256"))
            else:
                checks.append(_check("image", "Image-Prüfsumme", "bad",
                                     f"{path.name}: erwartet {sidecar[:16]}…, tatsächlich {actual[:16]}…",
                                     fix="Download korrupt oder manipuliert – Image neu holen, nicht flashen."))
    else:
        checks.append(_check("image", "Image", "info", "kein Image angegeben",
                             command="sha256sum rom.zip rom.zip.sha256"))

    bdir = Path(backup_dir).expanduser() if backup_dir else Path.home() / "DinGelSchwinG-Backup"
    if backup_dir:
        newest, newest_age = None, None
        if bdir.is_dir():
            for cand in sorted(bdir.iterdir(), key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)[:1]:
                try:
                    newest_age = int((time.time() - cand.stat().st_mtime) // 86400)
                    newest = cand.name
                except OSError:
                    continue
        if newest is not None and newest_age is not None and newest_age <= BACKUP_FRESH_DAYS:
            checks.append(_check("backup", "Backup vorhanden", "ok", f"{newest} · {newest_age} Tage alt"))
        else:
            checks.append(_check("backup", "Backup vorhanden", "warn",
                                 f"{bdir}: " + (f"letztes Backup {newest_age} Tage alt ({newest})" if newest else "kein Backup gefunden"),
                                 fix="Vor dem Eingriff: adb backup / Profilexport (siehe desktop/data/skillz_adb.md → adb_backup)"))
    else:
        checks.append(_check("backup", "Backup", "info", "Backup-Ordner nicht angegeben",
                             fix="--backup-dir <pfad> setzen, dann prüft die Checkliste auf Frische"))

    checks.append(_check("arb", "Anti-Rollback (ARB)", "info",
                         "ARB-Stand steht nur im Bootloader-Modus: `fastboot getvar anti`. "
                         "Ein Downgrade unter den Stand brennt unwiderruflich – deshalb hier Warnung statt Automatisierung.",
                         command="fastboot getvar anti", fix="Nur mit freigegebenem Image flashen, dessen OS-Version >= ARB-Stand ist"))
    checks.append(_check("scope", "Umfang", "info",
                         "Bewusst read-only: kein Unlock, kein Flashen, keine IMEI-/FRP-Eingriffe – die gehören in Herstellertools mit Eigentumsnachweis."))

    statuses = [c["status"] for c in checks]
    verdict = "blockiert" if "bad" in statuses else ("attention" if "warn" in statuses else "ok")
    return {
        "ok": verdict != "blockiert",
        "verdict": verdict,
        "checks": checks,
        "devices": named,
        "target": (target or {}).get("serial") or None,
        "images_dir": str(root),
        "adb": exe or None,
        "note": "Vorabprüfung ist Lesezugriff – sie ersetzt keine Freigabe durch die Wartungsverantwortlichen.",
    }


# ---------------------------------------------------------------------------
# Selbsttest
# ---------------------------------------------------------------------------
def selftest() -> int:
    failed = 0
    store = default_store(refresh=True)
    if store.lookup("0x18d1") and store.describe("0x18d1")["name"].lower().startswith("google"):
        print(f"[ok]   vendors.lookup        {store.describe('0x18d1')['name']} · {len(store.vendors)} Einträge")
    else:
        failed += 1
        print("[FAIL] vendors.lookup        0x18d1 nicht aufgelöst")

    ids = parse_usb_ids("# comment\n04e8  Samsung Electronics Co., Ltd\n\t7268  Galaxy S9\n")
    if ids.get("0x04e8", "").startswith("Samsung") and len(ids) == 1:
        print("[ok]   vendors.parse_usb_ids ein Vendor, Produktzeile ignoriert")
    else:
        failed += 1
        print(f"[FAIL] vendors.parse_usb_ids {ids}")

    rules = parse_udev_rules('# Honeywell\nSUBSYSTEM=="usb", ATTR{idVendor}=="0c2e", MODE="0666"\n')
    if rules.get("0x0c2e"):
        print("[ok]   vendors.parse_udev      Honeywell-Regel erkannt")
    else:
        failed += 1
        print(f"[FAIL] vendors.parse_udev      {rules}")

    ini = parse_adb_usb_ini("# Liste\n0x18d1\n0c2e\n")
    if set(ini) == {"0x18d1", "0x0c2e"}:
        print("[ok]   vendors.parse_adb_ini   zwei VIDs")
    else:
        failed += 1
        print(f"[FAIL] vendors.parse_adb_ini   {ini}")

    devs = parse_adb_devices("List of devices attached\nR58M  device product:a5xsa model:SM_A515F device:a51 transport_id:2\nZZ1  unauthorized\n")
    if len(devs) == 2 and devs[0]["model"] == "SM A515F" and devs[1]["state"] == "unauthorized":
        print("[ok]   vendors.parse_adb       zwei Geräte inkl. unauthorized")
    else:
        failed += 1
        print(f"[FAIL] vendors.parse_adb       {devs}")

    lsusb = parse_lsusb("Bus 001 Device 005: ID 0c2e:0c2f Honeywell Intl. Corp.\n")
    if lsusb and lsusb[0]["vid"] == "0x0c2e" and lsusb[0]["pid"] == "0x0c2f":
        print("[ok]   vendors.parse_lsusb     0c2e:0c2f")
    else:
        failed += 1
        print(f"[FAIL] vendors.parse_lsusb     {lsusb}")

    props_low = {"__battery_level": "18", "ro.build.version.security_patch": "2021-04-05",
                 "ro.boot.verifiedbootstate": "orange", "ro.boot.flash.locked": "0",
                 "ro.product.model": "CT45", "ro.build.version.release": "13"}
    report = preflight(store, devices=[{"serial": "CT45-1", "state": "device", "vendor_id": "0x0c2e"}],
                       runner=lambda _s, p=props_low: {"props": dict(p)})
    ids_seen = {c["id"]: c["status"] for c in report["checks"]}
    ok_att = preflight(store, devices=[{"serial": "CT45-2", "state": "device"}],
                       expected_model="CT45",
                       runner=lambda _s, p=props_low: {"props": {**p, "__battery_level": "88"}})
    ok_att_seen = {c["id"]: c["status"] for c in ok_att["checks"]}
    if (report["verdict"] == "blockiert" and ids_seen.get("akku") == "bad"
            and ok_att["verdict"] == "attention" and ok_att_seen.get("modell") == "ok"
            and len(report["checks"]) >= 8):
        print(f"[ok]   vendors.preflight       blockiert/attention · {len(report['checks'])} Prüfpunkte · "
              f"Hersteller {report['devices'][0].get('manufacturer')}")
    else:
        failed += 1
        print(f"[FAIL] vendors.preflight       {report['verdict']} {ids_seen} | {ok_att['verdict']} {ok_att_seen}")

    block = preflight(store, devices=[{"serial": "CT45-1", "state": "device"}], expected_model="CT60",
                      runner=lambda _s: {"props": {"ro.product.model": "CT45"}})
    if block["verdict"] == "blockiert":
        print("[ok]   vendors.preflight-block falsches Modell bremst aus")
    else:
        failed += 1
        print(f"[FAIL] vendors.preflight-block {block['verdict']}")

    tmp = Path("/tmp")
    if tmp.is_dir():
        probe = tmp / "dgs-image-probe.zip"
        probe.write_bytes(b"payload")
        try:
            path, err = resolve_image("dgs-image-probe.zip", tmp)
            escape, escape_err = resolve_image("../../etc/passwd", tmp)
            if path == probe and err is None and escape is None and escape_err == "pfad_nicht_erlaubt":
                print("[ok]   vendors.image_pfad    Bild nur aus freigegebenem Ordner")
            else:
                failed += 1
                print(f"[FAIL] vendors.image_pfad    {path},{err} / {escape},{escape_err}")
        finally:
            probe.unlink(missing_ok=True)
    return failed


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(1 if selftest() else 0)
