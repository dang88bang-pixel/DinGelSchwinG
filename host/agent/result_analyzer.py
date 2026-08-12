"""Result-Analyzer – interpretiert Befehl-Ausgaben (kein Roh-Output).

Erkennt Systemlast (uptime), Speicher (free -h), Festplatte (df -h),
Fehler/Success-Muster und stellt Metriken strukturiert bereit.
"""
from __future__ import annotations

import re
from typing import Any

ERROR_WORDS = re.compile(r"error|fail|denied|not found|cannot|unreachable|timed out",
                         re.IGNORECASE)
SUCCESS_WORDS = re.compile(r"success|ok\b|done|completed|0 received",
                           re.IGNORECASE)


class ResultAnalyzer:
    @staticmethod
    def analyze(command: str, output: str, device_alias: str,
                exit_code: int | None = None) -> dict[str, Any]:
        out = output or ""
        low = out.lower()
        result: dict[str, Any] = {
            "raw": out[:1500],
            "summary": "",
            "status": "unknown",
            "metrics": {},
            "exit_code": exit_code,
        }

        # 1) Uptime / Load
        m = re.search(r"load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)", low)
        if m:
            result["metrics"]["load_1min"] = float(m.group(1))
            result["metrics"]["load_5min"] = float(m.group(2))
            result["metrics"]["load_15min"] = float(m.group(3))
            result["summary"] += (f"📊 Systemlast: {m.group(1)} (1min) / "
                                  f"{m.group(2)} (5min) / {m.group(3)} (15min). ")
            if float(m.group(1)) > 4.0:
                result["summary"] += "⚠️ **Hohe Last!** "

        # 2) Speicher (free -h)
        m = re.search(r"mem:\s+([\d.,]+[gmt]?i?)\s+([\d.,]+[gmt]?i?)\s+([\d.,]+[gmt]?i?)", low)
        if m:
            total, used, free = m.groups()
            result["metrics"]["memory_total"] = total
            result["metrics"]["memory_used"] = used
            result["metrics"]["memory_free"] = free
            result["summary"] += f"💾 Speicher: {used} von {total} belegt (frei: {free}). "

        # 3) Festplatte (df -h)
        m = re.search(r"(\d+)%\s+(\S+)$", out, re.MULTILINE)
        if m:
            usage = int(m.group(1))
            path = m.group(2)
            result["metrics"]["disk_usage_percent"] = usage
            result["metrics"]["disk_path"] = path
            result["summary"] += f"💿 Festplatte {path}: {usage}% belegt. "
            if usage > 85:
                result["summary"] += "⚠️ **Wenig Speicherplatz!** "

        # 4) Ping-Latenz
        m = re.search(r"rtt min/avg/max/mdev\s*=\s*[\d.]+/([\d.]+)", low)
        if m:
            result["metrics"]["latency_ms"] = float(m.group(1))
            result["summary"] += f"🌐 Latenz: {m.group(1)} ms. "

        # 5) Batterie
        m = re.search(r"battery[_ ]?percent[^:]*[:=]?\s*(\d+)", low)
        if m:
            result["metrics"]["battery_percent"] = int(m.group(1))
            result["summary"] += f"🔋 Batterie: {m.group(1)} %. "

        # 6) Fehler-/Erfolgs-Erkennung
        if ERROR_WORDS.search(low):
            result["status"] = "error"
            result["summary"] += "❌ **Fehler erkannt.** "
        elif SUCCESS_WORDS.search(low):
            result["status"] = "success"
            result["summary"] += "✅ **Befehl erfolgreich.** "
        else:
            result["status"] = "executed"
            result["summary"] += "ℹ️ Befehl ausgeführt (siehe Ausgabe). "

        if not result["summary"]:
            result["summary"] = f"Ausgabe von '{command}' auf {device_alias}:"
        return result

    @staticmethod
    def format(entry: dict[str, Any]) -> str:
        """Menschenlesbare Zusammenfassung eines Analyse-Ergebnisses."""
        lines = [f"📟 **{entry.get('alias', entry.get('device', 'Gerät'))}**"]
        if entry.get("ok") is False:
            lines.append(f"   ❌ {entry.get('error', 'Fehler')}")
            return "\n".join(lines)
        analysis = entry.get("analysis") or {}
        if analysis.get("summary"):
            lines.append(f"   {analysis['summary']}")
        if entry.get("output") and not analysis.get("summary"):
            lines.append(f"   {str(entry.get('output'))[:300]}")
        return "\n".join(lines)
