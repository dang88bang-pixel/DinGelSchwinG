"""Device-Resolver – findet gebundene Geräte aus natürlichen Angaben.

Unterstützt exakte Namen/Aliase, IP/MAC, Typ-Filter (ssh/usb/ble/http/…),
Status-Filter (online/offline), Teilstrings und unscharfe Suche (Tippfehler).
"""
from __future__ import annotations

import re
from difflib import get_close_matches
from typing import Any

TYPE_KEYWORDS = {
    "ssh": ("ssh", "server", "linux", "terminal"),
    "http": ("http", "web", "fritz", "router", "shelly", "tasmota", "drucker",
             "printer", "api"),
    "https": ("https",),
    "ble": ("ble", "bluetooth", "kopfhörer", "headphone", "earbud", "sensor",
            "tracker", "token", "tag", "beacon"),
    "bluetooth": ("box", "lautsprecher", "speaker", "musik", "soundbar"),
    "ping": ("ping", "handy", "smartphone", "telefon", "phone", "tablet", "drucker"),
    "serial": ("serial", "usb", "dongle", "uart", "seriell"),
    "dongle": ("dongle", "usb", "adapter"),
}

STATUS_WORDS = {
    "online": ("online", "erreichbar", "verbunden", "aktiv"),
    "offline": ("offline", "nicht erreichbar", "getrennt", "aus"),
    "bound": ("gebunden", "gebonded"),
}


class DeviceResolver:
    @staticmethod
    def resolve(devices: list[dict[str, Any]], query: str,
                ) -> tuple[list[dict[str, Any]] | None, str]:
        """Liefert (passende Geräte, Erklärung). None = kein Treffer."""
        query_lower = query.strip().lower()
        if not query_lower or query_lower in ("alle", "all", "alle geräte",
                                              "alle geraete", "alle gerate",
                                              "alle devices"):
            return devices, f"Alle {len(devices)} gebundenen Geräte."

        # 0) Status-Wort im Query (z. B. "welche geräte sind online")
        for status, words in STATUS_WORDS.items():
            if any(w in query_lower for w in words):
                want = status == "online"
                matched = [d for d in devices
                           if bool(d.get("online", False)) is want]
                if matched:
                    return matched, f"{len(matched)} Gerät(e) mit Status '{status}'."
                return None, f"Keine Geräte mit Status '{status}'."

        # „alle <typ>“ (z. B. "alle usb", "alle ble")
        if query_lower.startswith("alle "):
            rest = query_lower[5:].strip()
            for proto, words in TYPE_KEYWORDS.items():
                if rest == proto or rest in words:
                    matched = [d for d in devices
                               if str(d.get("protocol")) == proto
                               or str(d.get("kind", "")).lower() == rest]
                    if matched:
                        return matched, f"{len(matched)} Gerät(e) mit Typ '{proto}'."
                    return None, f"Keine Geräte mit Typ '{proto}' gebunden."

        # 1) Exakter Match auf Alias / Node-ID / IP / MAC
        for dev in devices:
            hay = " ".join(str(dev.get(k) or "") for k in
                           ("alias", "label", "id", "nodeId", "address", "ip", "mac"))
            if dev.get("alias", "").lower() == query_lower \
                    or hay.lower().split() and query_lower in hay.lower().split():
                return [dev], f"Gerät '{dev.get('alias')}' gefunden (exakter Match)."

        # 2) Typ-Filter
        for proto, words in TYPE_KEYWORDS.items():
            if query_lower in words or query_lower == proto:
                matched = [d for d in devices
                           if str(d.get("protocol")) == proto
                           or str(d.get("kind", "")).lower() == query_lower]
                if matched:
                    return matched, f"{len(matched)} Gerät(e) mit Typ '{proto}'."
                return None, f"Keine Geräte mit Typ '{proto}' gebunden."

        # 3) Teilstring-Match (Alias/IP/Kind)
        matched = [d for d in devices
                   if query_lower in str(d.get("alias", "")).lower()
                   or query_lower in str(d.get("label", "")).lower()
                   or query_lower in str(d.get("ip", "")).lower()
                   or query_lower in str(d.get("mac", "")).lower()
                   or query_lower in str(d.get("kind", "")).lower()]
        if matched:
            return matched, f"{len(matched)} Gerät(e) enthalten '{query.strip()}'."

        # 4) Unscharfe Suche (Tippfehler-Toleranz)
        aliases = [str(d.get("alias", "")) for d in devices]
        close = get_close_matches(query_lower, [a.lower() for a in aliases],
                                  n=3, cutoff=0.7)
        if close:
            matched = [d for d in devices if d.get("alias", "").lower() in close]
            return matched, f"Meinten Sie vielleicht: {', '.join(close)}?"

        # 5) Fallback
        available = ", ".join(str(d.get("alias")) for d in devices) or "keine"
        return None, f"Kein Gerät gefunden für '{query.strip()}'. Verfügbar: {available}"

    @staticmethod
    def infer_command(text: str) -> tuple[str, str]:
        """Extrahiert (Aktion, Rest) – z. B. ('status', 'alle')."""
        low = text.lower()
        patterns = [
            (r"status|zustand|uptime|wie geht es", "status"),
            (r"reboot|neustart|restart", "reboot"),
            (r"logs?|syslog|ausgabe", "logs"),
            (r"ping|erreichbar|antwortet", "ping"),
            (r"batterie|battery", "battery"),
            (r"play|wiedergabe|start", "play"),
            (r"pause|stoppen? die musik|anhalten", "pause"),
            (r"volume|lautstärke|lautstaerke", "volume"),
            (r"ip|adresse|netzwerk", "ip"),
            (r"temp|temperatur|wärme|waerme", "temp"),
            (r"liste|list|zeige|welche|anzeige|auflisten", "list"),
            (r"execute|führe aus|fuehre aus|führ aus|befehl", "execute"),
        ]
        for pattern, action in patterns:
            m = re.search(pattern, low)
            if m:
                rest = low[:m.start()] + low[m.end():]
                rest = re.sub(r"\b(bitte|mal|doch|mir|von|auf|bei|für|fuer|an)\b", " ", rest)
                rest = re.sub(r"\s+", " ", rest).strip()
                return action, rest
        return "status", low
