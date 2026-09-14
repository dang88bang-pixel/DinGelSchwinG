#!/usr/bin/env python3
"""DinGelAg V0.1 — Referenzimplementation des Inventur-Kerns (Python/stdlib).

Warum diese Datei existiert
---------------------------
Die App ist Flutter/Dart. In der Entwicklungsumgebung ist jedoch kein
Flutter-SDK erreichbar, deshalb wird die **Kernlogik hier sprachunabhängig
zweimal gebaut**: `lib/domain/inventory_repository.dart` für die App und dieses
Modul als ausführbare Referenz. Beide arbeiten gegen dasselbe
`schema/schema.sql`, und `reference/tests/` prüft den Ablauf aus dem
Lastenheft (Scan → Artikel → Menge → Event → Persistenz → Suche → Historie)
gegen eine echte SQLite-Datei.

Regeln (V0.1, offline)
----------------------
* Scan eines bekannten Barcodes: `autoIncrement=1` → Menge +1 und ein
  `scan`-Event; `autoIncrement=0` → Artikel wird zum Bearbeiten geöffnet.
* Scan eines unbekannten Barcodes: kein automatisches Anlegen — die Antwort
  trägt den Barcode zurück, die UI fragt „Neuen Artikel anlegen?".
* Jede Mengenänderung schreibt ein Event mit `quantityBefore`/`quantityAfter`;
  die Historie ist damit auch nach einem Restore nachvollziehbar.
* Keine Netzwerk-, Cloud- oder KI-Abhängigkeit: sqlite3-Datei, sonst nichts.

Ausführen der Tests:  python3 -m unittest discover -s dingelag/reference/tests
"""
from __future__ import annotations

import os
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Sequence

SCHEMA_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "schema", "schema.sql")

#: Ereignisarten laut Schema-Constraint.
EVENT_TYPES: tuple[str, ...] = (
    "scan", "manual", "create", "correction", "import", "delete",
)

#: Scan-Quellen (V0.1: Tastatur-Keil; der Honeywell-Intent folgt in Schritt 2).
SCAN_SOURCES: tuple[str, ...] = ("hid", "intent", "ui", "import")

DEFAULT_SETTINGS: dict[str, str] = {
    "scannerProfile": "hid-keyboard-wedge",
    "defaultLocation": "",
    "autoIncrement": "1",
    "soundEnabled": "1",
    "vibrationEnabled": "1",
}

BARCODE_RE = re.compile(r"^[A-Za-z0-9._:+/-]{1,64}$")
MAX_QUANTITY = 10_000_000


class InventoryError(Exception):
    """Basisfehler — meldet immer den Grund, rät nichts."""


class ValidationError(InventoryError):
    """Eingabe passt nicht zum Datenmodell (Barcode, Name, Menge)."""


class DuplicateBarcode(InventoryError):
    """Barcode ist bereits vergeben (ein Barcode = genau ein Artikel)."""


class UnknownItem(InventoryError):
    """Artikel-ID existiert nicht."""


def utc_now(clock: Callable[[], datetime] | None = None) -> str:
    """ISO-8601 in UTC — identisch in Dart (`DateTime.now().toUtc()`)."""
    value = clock() if clock else datetime.now(timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# ---------------------------------------------------------------------------
# Modelle
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Item:
    """Ein Artikel (Lastenheft V0.1 § 3 `Item`)."""

    id: int
    barcode: str
    name: str
    description: str = ""
    category: str = ""
    quantity: int = 0
    unit: str = "Stk"
    location: str = ""
    createdAt: str = ""
    updatedAt: str = ""

    @staticmethod
    def from_row(row: sqlite3.Row | Sequence[Any]) -> "Item":
        data = dict(row) if isinstance(row, sqlite3.Row) else dict(zip(ITEM_COLUMNS, row))
        return Item(
            id=int(data["id"]),
            barcode=str(data["barcode"]),
            name=str(data["name"]),
            description=str(data.get("description") or ""),
            category=str(data.get("category") or ""),
            quantity=int(data.get("quantity") or 0),
            unit=str(data.get("unit") or "Stk"),
            location=str(data.get("location") or ""),
            createdAt=str(data.get("createdAt") or ""),
            updatedAt=str(data.get("updatedAt") or ""),
        )

    def to_map(self) -> dict[str, Any]:
        """Feldnamen wie in der Datenbank und im JSON-Backup (camelCase)."""
        return {
            "id": self.id, "barcode": self.barcode, "name": self.name,
            "description": self.description, "category": self.category,
            "quantity": self.quantity, "unit": self.unit, "location": self.location,
            "createdAt": self.createdAt, "updatedAt": self.updatedAt,
        }


ITEM_COLUMNS: tuple[str, ...] = (
    "id", "barcode", "name", "description", "category",
    "quantity", "unit", "location", "createdAt", "updatedAt",
)

EVENT_COLUMNS: tuple[str, ...] = (
    "id", "itemId", "barcode", "type", "quantityBefore",
    "quantityAfter", "source", "timestamp",
)


@dataclass(frozen=True)
class InventoryEvent:
    """Eine Mengenänderung (Lastenheft V0.1 § 3 `InventoryEvent`)."""

    id: int
    itemId: int
    barcode: str
    type: str
    quantityBefore: int
    quantityAfter: int
    source: str = "hid"
    timestamp: str = ""
    itemName: str = field(default="")

    @staticmethod
    def from_row(row: sqlite3.Row) -> "InventoryEvent":
        data = dict(row)
        return InventoryEvent(
            id=int(data["id"]),
            itemId=int(data["itemId"]),
            barcode=str(data["barcode"]),
            type=str(data["type"]),
            quantityBefore=int(data["quantityBefore"]),
            quantityAfter=int(data["quantityAfter"]),
            source=str(data.get("source") or "hid"),
            timestamp=str(data.get("timestamp") or ""),
            itemName=str(data.get("itemName") or ""),
        )

    def to_map(self) -> dict[str, Any]:
        return {
            "id": self.id, "itemId": self.itemId, "barcode": self.barcode,
            "type": self.type, "quantityBefore": self.quantityBefore,
            "quantityAfter": self.quantityAfter, "source": self.source,
            "timestamp": self.timestamp,
        }

    def label(self) -> str:
        """Anzeigezeile wie im Lastenheft § 6: `123456  Schraube M8  12 → 13`."""
        name = self.itemName or self.barcode
        return f"{self.barcode}  {name}  {self.quantityBefore} → {self.quantityAfter}"


@dataclass(frozen=True)
class ScanOutcome:
    """Ergebnis eines Scans — die drei Pfade aus Lastenheft § 4/§ 5."""

    kind: str            # 'incremented' | 'open_item' | 'unknown'
    barcode: str
    item: Item | None = None
    event: InventoryEvent | None = None
    autoIncrement: bool = True

    @property
    def is_known(self) -> bool:
        return self.kind in ("incremented", "open_item")


# ---------------------------------------------------------------------------
# Kern
# ---------------------------------------------------------------------------
class InventoryCore:
    """SQLite-gestützte Inventur-Logik (Spiegel von `inventory_repository.dart`)."""

    def __init__(self, path: str, clock: Callable[[], datetime] | None = None) -> None:
        self.path = path
        self._clock = clock
        self._conn = sqlite3.connect(path)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._apply_schema()
        self._ensure_settings()

    # -- Lebenszyklus -------------------------------------------------------
    def _apply_schema(self) -> None:
        with open(SCHEMA_PATH, encoding="utf-8") as fh:
            script = fh.read()
        self._conn.executescript(script)
        self._conn.commit()

    def _ensure_settings(self) -> None:
        for key, value in DEFAULT_SETTINGS.items():
            self._conn.execute(
                "INSERT INTO app_settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO NOTHING", (key, value))
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def __enter__(self) -> "InventoryCore":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def reopen(self) -> "InventoryCore":
        """Neue Instanz auf derselben Datei — prüft Persistenz über App-Starts."""
        self.close()
        return InventoryCore(self.path, self._clock)

    # -- Einstellungen ------------------------------------------------------
    def setting(self, key: str, default: str = "") -> str:
        row = self._conn.execute(
            "SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
        return str(row["value"]) if row else default

    def set_setting(self, key: str, value: str | bool | int) -> None:
        text = ("1" if value else "0") if isinstance(value, bool) else str(value)
        self._conn.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, text))
        self._conn.commit()

    def settings(self) -> dict[str, str]:
        rows = self._conn.execute("SELECT key, value FROM app_settings ORDER BY key").fetchall()
        return {str(r["key"]): str(r["value"]) for r in rows}

    @property
    def auto_increment(self) -> bool:
        return self.setting("autoIncrement", "1") not in ("0", "false", "")

    # -- Artikel ------------------------------------------------------------
    def create_item(self, barcode: str, name: str, *, description: str = "",
                    category: str = "", quantity: int = 0, unit: str = "Stk",
                    location: str = "", source: str = "ui") -> Item:
        code = validate_barcode(barcode)
        title = validate_text(name, "name", 1, 120)
        amount = validate_quantity(quantity)
        if self.find_by_barcode(code) is not None:
            raise DuplicateBarcode(f"Barcode {code} ist bereits einem Artikel zugeordnet.")
        stamp = utc_now(self._clock)
        row = (code, title,
               validate_text(description, "description", 0, 500),
               validate_text(category, "category", 0, 120),
               amount,
               validate_text(unit or "Stk", "unit", 1, 16),
               validate_text(location or self.setting("defaultLocation"), "location", 0, 120),
               stamp, stamp)
        with self._conn:
            cur = self._conn.execute(
                "INSERT INTO items (barcode, name, description, category, quantity, unit,"
                " location, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", row)
            item_id = int(cur.lastrowid or 0)
            self._conn.execute(
                "INSERT INTO inventory_events (itemId, barcode, type, quantityBefore,"
                " quantityAfter, source, timestamp) VALUES (?, ?, 'create', 0, ?, ?, ?)",
                (item_id, code, amount, source, stamp))
        item = self.get_item(item_id)
        assert item is not None
        return item

    def get_item(self, item_id: int) -> Item | None:
        row = self._conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
        return Item.from_row(row) if row else None

    def find_by_barcode(self, barcode: str) -> Item | None:
        row = self._conn.execute(
            "SELECT * FROM items WHERE barcode = ?", (barcode.strip(),)).fetchone()
        return Item.from_row(row) if row else None

    def list_items(self, query: str | None = None, limit: int = 500) -> list[Item]:
        sql = "SELECT * FROM items"
        params: list[Any] = []
        tokens = [t for t in (query or "").split() if t]
        if tokens:
            clauses = []
            for token in tokens:
                pattern = f"%{escape_like(token)}%"
                clauses.append("(barcode LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'"
                               " OR category LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\')")
                params.extend([pattern] * 4)
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY name COLLATE NOCASE, barcode LIMIT ?"
        params.append(int(limit))
        return [Item.from_row(r) for r in self._conn.execute(sql, params).fetchall()]

    def set_quantity(self, item_id: int, quantity: int, *, event_type: str = "manual",
                     source: str = "ui") -> Item:
        item = self.get_item(item_id)
        if item is None:
            raise UnknownItem(f"Artikel {item_id} existiert nicht.")
        if event_type not in EVENT_TYPES:
            raise ValidationError(f"Unbekannte Ereignisart '{event_type}'.")
        amount = validate_quantity(quantity)
        stamp = utc_now(self._clock)
        with self._conn:
            self._conn.execute(
                "UPDATE items SET quantity = ?, updatedAt = ? WHERE id = ?",
                (amount, stamp, item_id))
            self._conn.execute(
                "INSERT INTO inventory_events (itemId, barcode, type, quantityBefore,"
                " quantityAfter, source, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (item_id, item.barcode, event_type, item.quantity, amount, source, stamp))
        updated = self.get_item(item_id)
        assert updated is not None
        return updated

    def update_item(self, item_id: int, *, name: str | None = None,
                    description: str | None = None, category: str | None = None,
                    unit: str | None = None, location: str | None = None) -> Item:
        item = self.get_item(item_id)
        if item is None:
            raise UnknownItem(f"Artikel {item_id} existiert nicht.")
        values: dict[str, Any] = {}
        if name is not None:
            values["name"] = validate_text(name, "name", 1, 120)
        if description is not None:
            values["description"] = validate_text(description, "description", 0, 500)
        if category is not None:
            values["category"] = validate_text(category, "category", 0, 120)
        if unit is not None:
            values["unit"] = validate_text(unit, "unit", 1, 16)
        if location is not None:
            values["location"] = validate_text(location, "location", 0, 120)
        if not values:
            return item
        values["updatedAt"] = utc_now(self._clock)
        assignments = ", ".join(f"{key} = ?" for key in values)
        with self._conn:
            self._conn.execute(f"UPDATE items SET {assignments} WHERE id = ?",
                               (*values.values(), item_id))
        updated = self.get_item(item_id)
        assert updated is not None
        return updated

    # -- Scannen ------------------------------------------------------------
    def handle_scan(self, barcode: str, source: str = "hid") -> ScanOutcome:
        """Ein Scan, drei mögliche Pfade — sonst nichts (keine KI, kein Netz)."""
        code = barcode.strip()
        if not code:
            raise ValidationError("Leerer Barcode.")
        item = self.find_by_barcode(code)
        if item is None:
            return ScanOutcome(kind="unknown", barcode=code, autoIncrement=self.auto_increment)
        if not self.auto_increment:
            return ScanOutcome(kind="open_item", barcode=code, item=item,
                               autoIncrement=False)
        stamp = utc_now(self._clock)
        before, after = item.quantity, item.quantity + 1
        with self._conn:
            self._conn.execute("UPDATE items SET quantity = ?, updatedAt = ? WHERE id = ?",
                               (after, stamp, item.id))
            self._conn.execute(
                "INSERT INTO inventory_events (itemId, barcode, type, quantityBefore,"
                " quantityAfter, source, timestamp) VALUES (?, ?, 'scan', ?, ?, ?, ?)",
                (item.id, code, before, after, source, stamp))
        fresh = self.get_item(item.id)
        event = self.history(limit=1, item_id=item.id)[0] if fresh else None
        return ScanOutcome(kind="incremented", barcode=code, item=fresh, event=event,
                           autoIncrement=True)

    # -- Historie -----------------------------------------------------------
    def history(self, limit: int = 50, item_id: int | None = None) -> list[InventoryEvent]:
        sql = ("SELECT e.*, i.name AS itemName FROM inventory_events e"
               " LEFT JOIN items i ON i.id = e.itemId")
        params: list[Any] = []
        if item_id is not None:
            sql += " WHERE e.itemId = ?"
            params.append(int(item_id))
        sql += " ORDER BY e.id DESC LIMIT ?"
        params.append(int(limit))
        return [InventoryEvent.from_row(r) for r in self._conn.execute(sql, params).fetchall()]

    # -- Bestand ------------------------------------------------------------
    def stats(self) -> dict[str, int]:
        row = self._conn.execute(
            "SELECT COUNT(*) AS items, COALESCE(SUM(quantity), 0) AS units FROM items").fetchone()
        events = self._conn.execute("SELECT COUNT(*) AS n FROM inventory_events").fetchone()
        return {"items": int(row["items"]), "units": int(row["units"]),
                "events": int(events["n"])}

    def categories(self) -> list[str]:
        rows = self._conn.execute(
            "SELECT DISTINCT category FROM items WHERE category <> '' "
            "ORDER BY category COLLATE NOCASE").fetchall()
        return [str(r["category"]) for r in rows]

    def locations(self) -> list[str]:
        rows = self._conn.execute(
            "SELECT DISTINCT location FROM items WHERE location <> '' "
            "ORDER BY location COLLATE NOCASE").fetchall()
        return [str(r["location"]) for r in rows]

    def clear_all(self) -> dict[str, int]:
        """Alle Artikel + Events löschen (Einstellungen bleiben erhalten)."""
        before = self.stats()
        with self._conn:
            self._conn.execute("DELETE FROM inventory_events")
            self._conn.execute("DELETE FROM items")
            self._conn.execute("DELETE FROM sqlite_sequence WHERE name IN ('items','inventory_events')")
        return before


# ---------------------------------------------------------------------------
# Prüfungen (identisch in Dart: lib/domain/validators.dart)
# ---------------------------------------------------------------------------
def validate_barcode(raw: str) -> str:
    code = (raw or "").strip()
    if not code:
        raise ValidationError("Barcode fehlt.")
    if not BARCODE_RE.match(code):
        raise ValidationError(
            f"Barcode '{code[:40]}' enthält unerlaubte Zeichen "
            "(erlaubt: A-Z a-z 0-9 . _ : + / - , max. 64 Zeichen).")
    return code


def validate_text(raw: str, field_name: str, min_len: int, max_len: int) -> str:
    text = (raw or "").strip()
    if len(text) < min_len:
        raise ValidationError(f"{field_name} darf nicht leer sein.")
    if len(text) > max_len:
        raise ValidationError(f"{field_name} ist länger als {max_len} Zeichen.")
    if "\n" in text or "\r" in text:
        raise ValidationError(f"{field_name} darf keine Zeilenumbrüche enthalten.")
    return text


def validate_quantity(raw: Any) -> int:
    try:
        amount = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValidationError(f"Menge '{raw}' ist keine ganze Zahl.") from exc
    if amount < 0:
        raise ValidationError("Menge darf nicht negativ sein.")
    if amount > MAX_QUANTITY:
        raise ValidationError(f"Menge über {MAX_QUANTITY} ist unplausibel.")
    return amount


def escape_like(token: str) -> str:
    return token.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def schema_sql() -> str:
    with open(SCHEMA_PATH, encoding="utf-8") as fh:
        return fh.read()


def schema_columns(table: str) -> list[str]:
    """Spaltennamen aus `schema.sql` — für Paritätsprüfungen gegen Dart."""
    match = re.search(rf"CREATE TABLE IF NOT EXISTS {table} \((.*?)\n\);",
                      schema_sql(), re.S)
    if not match:
        raise InventoryError(f"Tabelle {table} nicht im Schema gefunden.")
    columns: list[str] = []
    for line in match.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith("--"):
            continue
        first = line.split()[0]
        if first.upper() in ("PRIMARY", "FOREIGN", "UNIQUE", "CHECK", "CONSTRAINT"):
            continue
        # Fortsetzungszeilen eines mehrzeiligen Constraints (z. B. CHECK (type IN
        #   'scan', …)) sind keine Spalten.
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", first):
            continue
        columns.append(first)
    return columns


def open_core(path: str, clock: Callable[[], datetime] | None = None) -> InventoryCore:
    """Kurzform für Tests und Skripte."""
    return InventoryCore(path, clock)


__all__ = [
    "DEFAULT_SETTINGS", "DuplicateBarcode", "EVENT_TYPES", "InventoryCore",
    "InventoryError", "InventoryEvent", "Item", "SCAN_SOURCES", "ScanOutcome",
    "UnknownItem", "ValidationError", "escape_like", "open_core", "schema_columns",
    "schema_sql", "utc_now", "validate_barcode", "validate_quantity", "validate_text",
]
