#!/usr/bin/env python3
"""DinGelAg V0.1 — Tests des Inventur-Kerns gegen eine echte SQLite-Datei.

Abbildung der „Definition of Done“ aus dem Lastenheft § 14 auf ausführbare
Prüfungen. Die Schritte, die Hardware brauchen (APK installieren, CT45P
scannen), sind hier durch den Tastatur-Keil-Pfad ersetzt: `handle_scan()`
bekommt denselben Barcode, den der Scanner liefern würde.

  DoD  3  Artikel manuell anlegen            → TestArtikelAnlegen
  DoD  4-6 Scan findet Artikel, Menge +1     → TestScanAblauf
  DoD  7-9 App schließen/öffnen, Daten da    → TestPersistenz
  DoD 10  weiteren Barcode scannen           → TestScanAblauf
  DoD 11-12 unbekannter Barcode → anlegen    → TestUnbekannterBarcode
  DoD 13  Inventar durchsuchen               → TestSuche
  DoD 14  Historie anzeigen                  → TestHistorie
  DoD 17  Daten löschen                      → TestBestandLoeschen
  DoD 15-16, 18-19 (CSV/JSON, Backup)        → Schritt 2 der Ausbaustufe

Ausführen:  python3 -m unittest discover -s dingelag/reference/tests -v
"""
from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "reference"))

from inventory_core import (  # noqa: E402
    DEFAULT_SETTINGS, DuplicateBarcode, EVENT_TYPES, InventoryCore, ScanOutcome,
    ValidationError, UnknownItem, schema_columns,
)

SCHRAUBE = "4006381333931"   # Beispiel aus dem Lastenheft § 4
MUTTER = "789012"


class FixedClock:
    """Deterministische Uhr — Events tragen prüfbare Zeitstempel."""

    def __init__(self, start: datetime | None = None) -> None:
        self.now = start or datetime(2026, 9, 13, 10, 41, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        value = self.now
        self.now = self.now + timedelta(seconds=1)
        return value

    def iso(self) -> str:
        return self.now.strftime("%Y-%m-%dT%H:%M:%S.000Z")


class CoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.tmp.name, "dingelag.db")
        self.clock = FixedClock()
        self.core = InventoryCore(self.db_path, self.clock)

    def tearDown(self) -> None:
        self.core.close()
        self.tmp.cleanup()

    def artikel_anlegen(self) -> None:
        """Grundbestand wie im Lastenheft-Beispiel."""
        self.core.create_item(SCHRAUBE, "Schraube M8", category="Verbindungselemente",
                              quantity=12, unit="Stk", location="Lager 2")
        self.core.create_item(MUTTER, "Mutter M8", category="Verbindungselemente",
                              quantity=6, unit="Stk", location="Lager 2")


class TestArtikelAnlegen(CoreTest):
    def test_artikel_liegt_mit_allen_feldern_in_der_datenbank(self) -> None:
        item = self.core.create_item(SCHRAUBE, "Schraube M8", description="Edelstahl A2",
                                     category="Verbindungselemente", quantity=12,
                                     unit="Stk", location="Lager 2")
        self.assertEqual(SCHRAUBE, item.barcode)
        self.assertEqual(12, item.quantity)
        self.assertEqual("Lager 2", item.location)
        self.assertTrue(item.createdAt.endswith("Z"))
        self.assertEqual(item.createdAt, item.updatedAt)
        gelesen = self.core.find_by_barcode(SCHRAUBE)
        self.assertIsNotNone(gelesen)
        self.assertEqual(item.to_map(), gelesen.to_map())

    def test_anlegen_schreibt_create_event(self) -> None:
        item = self.core.create_item(SCHRAUBE, "Schraube M8", quantity=12)
        events = self.core.history(item_id=item.id)
        self.assertEqual(1, len(events))
        self.assertEqual("create", events[0].type)
        self.assertEqual(0, events[0].quantityBefore)
        self.assertEqual(12, events[0].quantityAfter)

    def test_doppelter_barcode_wird_abgelehnt(self) -> None:
        self.core.create_item(SCHRAUBE, "Schraube M8")
        with self.assertRaises(DuplicateBarcode):
            self.core.create_item(SCHRAUBE, "Schraube M8 (Kopie)")
        self.assertEqual(1, self.core.stats()["items"])

    def test_standardlagerort_wird_uebernommen(self) -> None:
        self.core.set_setting("defaultLocation", "Lager 3")
        item = self.core.create_item(SCHRAUBE, "Schraube M8")
        self.assertEqual("Lager 3", item.location)

    def test_unerlaubte_eingaben_werden_abgelehnt(self) -> None:
        with self.assertRaises(ValidationError):
            self.core.create_item("", "Ohne Barcode")
        with self.assertRaises(ValidationError):
            self.core.create_item("4006 3813", "Barcode mit Leerzeichen")
        with self.assertRaises(ValidationError):
            self.core.create_item(SCHRAUBE, "")
        with self.assertRaises(ValidationError):
            self.core.create_item(SCHRAUBE, "Schraube M8", quantity=-1)
        with self.assertRaises(ValidationError):
            self.core.create_item("x" * 65, "Zu langer Barcode")

    def test_erlaubte_barcode_zeichen(self) -> None:
        for code in (SCHRAUBE, "QR/2026-09", "ART.001+A", "SN:12345"):
            item = self.core.create_item(code, f"Artikel {code}")
            self.assertEqual(code, item.barcode)


class TestScanAblauf(CoreTest):
    def test_scan_erhoeht_menge_um_eins(self) -> None:
        """Lastenheft § 4: Menge 12 → Scan → 13."""
        self.artikel_anlegen()
        outcome = self.core.handle_scan(SCHRAUBE)
        self.assertEqual("incremented", outcome.kind)
        self.assertTrue(outcome.is_known)
        self.assertIsNotNone(outcome.item)
        self.assertEqual(13, outcome.item.quantity)
        self.assertIsNotNone(outcome.event)
        self.assertEqual(12, outcome.event.quantityBefore)
        self.assertEqual(13, outcome.event.quantityAfter)
        self.assertEqual("scan", outcome.event.type)

    def test_zweiter_scan_zaehlt_weiter(self) -> None:
        self.artikel_anlegen()
        self.core.handle_scan(SCHRAUBE)
        second = self.core.handle_scan(SCHRAUBE)
        self.assertEqual(14, second.item.quantity)
        self.assertEqual(13, second.event.quantityBefore)
        self.assertEqual({"items": 2, "units": 20, "events": 4}, self.core.stats())

    def test_scan_mit_leerzeichen_wird_bereinigt(self) -> None:
        self.artikel_anlegen()
        outcome = self.core.handle_scan(f"  {SCHRAUBE}\n")
        self.assertEqual("incremented", outcome.kind)
        self.assertEqual(SCHRAUBE, outcome.barcode)

    def test_leerer_scan_wird_abgelehnt(self) -> None:
        with self.assertRaises(ValidationError):
            self.core.handle_scan("   ")

    def test_scan_modus_oeffnet_artikel_statt_zu_zaehlen(self) -> None:
        """Lastenheft § 4: `SCAN = Artikel öffnen` als Einstellung."""
        self.artikel_anlegen()
        self.core.set_setting("autoIncrement", False)
        outcome = self.core.handle_scan(SCHRAUBE)
        self.assertEqual("open_item", outcome.kind)
        self.assertFalse(outcome.autoIncrement)
        self.assertEqual(12, outcome.item.quantity)
        self.assertEqual(2, len(self.core.history()), "kein Event beim reinen Öffnen")
        self.core.set_setting("autoIncrement", True)
        self.assertEqual("incremented", self.core.handle_scan(SCHRAUBE).kind)

    def test_menge_manuell_setzen_schreibt_event(self) -> None:
        item = self.core.create_item(SCHRAUBE, "Schraube M8", quantity=12)
        updated = self.core.set_quantity(item.id, 20, event_type="correction", source="ui")
        self.assertEqual(20, updated.quantity)
        event = self.core.history(limit=1)[0]
        self.assertEqual("correction", event.type)
        self.assertEqual((12, 20), (event.quantityBefore, event.quantityAfter))

    def test_menge_nicht_negativ_und_nicht_ueber_limit(self) -> None:
        item = self.core.create_item(SCHRAUBE, "Schraube M8", quantity=1)
        with self.assertRaises(ValidationError):
            self.core.set_quantity(item.id, -5)
        with self.assertRaises(ValidationError):
            self.core.set_quantity(item.id, 99_999_999)
        with self.assertRaises(UnknownItem):
            self.core.set_quantity(4242, 1)

    def test_datenbank_constraint_haelt_menge_nicht_negativ(self) -> None:
        item = self.core.create_item(SCHRAUBE, "Schraube M8", quantity=1)
        with self.assertRaises(sqlite3.IntegrityError):
            with self.core._conn:  # noqa: SLF001 — Prüft die DB-Regel selbst
                self.core._conn.execute(  # noqa: SLF001
                    "UPDATE items SET quantity = -1 WHERE id = ?", (item.id,))

    def test_unbekannte_ereignisart_wird_abgelehnt(self) -> None:
        item = self.core.create_item(SCHRAUBE, "Schraube M8")
        with self.assertRaises(ValidationError):
            self.core.set_quantity(item.id, 3, event_type="zauber")
        self.assertEqual(6, len(EVENT_TYPES))


class TestUnbekannterBarcode(CoreTest):
    def test_unbekannter_barcode_legt_nichts_an(self) -> None:
        """Lastenheft § 5: erst fragen, dann anlegen — nichts passiert automatisch."""
        self.artikel_anlegen()
        outcome = self.core.handle_scan("9783123456")
        self.assertEqual("unknown", outcome.kind)
        self.assertFalse(outcome.is_known)
        self.assertIsNone(outcome.item)
        self.assertEqual("9783123456", outcome.barcode)
        self.assertEqual(2, self.core.stats()["items"])
        self.assertEqual(2, len(self.core.history()), "kein Event für unbekannten Barcode")

    def test_nach_dem_anlegen_ist_der_barcode_bekannt(self) -> None:
        self.core.handle_scan("9783123456")
        item = self.core.create_item("9783123456", "Buch", category="Büro",
                                     quantity=1, location="Regal A")
        outcome = self.core.handle_scan("9783123456")
        self.assertEqual("incremented", outcome.kind)
        self.assertEqual(2, outcome.item.quantity)
        self.assertEqual(item.id, outcome.item.id)


class TestPersistenz(CoreTest):
    def test_daten_ueberleben_schliessen_und_neu_oeffnen(self) -> None:
        """DoD 7-9: App schließen, erneut öffnen, Daten sind noch vorhanden."""
        self.artikel_anlegen()
        self.core.handle_scan(SCHRAUBE)
        self.core.set_setting("defaultLocation", "Lager 2")
        self.core = self.core.reopen()
        item = self.core.find_by_barcode(SCHRAUBE)
        self.assertIsNotNone(item)
        self.assertEqual(13, item.quantity)
        self.assertEqual("Lager 2", self.core.setting("defaultLocation"))
        self.assertEqual({"items": 2, "units": 19, "events": 3}, self.core.stats())

    def test_historie_bleibt_nach_neustart_vollstaendig(self) -> None:
        self.artikel_anlegen()
        self.core.handle_scan(SCHRAUBE)
        self.core.handle_scan(SCHRAUBE)
        self.core = self.core.reopen()
        entries = self.core.history()
        self.assertEqual(4, len(entries))
        self.assertEqual(["scan", "scan", "create", "create"], [e.type for e in entries])

    def test_datei_wird_angelegt_und_schema_ist_idempotent(self) -> None:
        self.assertTrue(os.path.isfile(self.db_path))
        erneut = InventoryCore(self.db_path, self.clock)   # zweites Öffnen desselben Schemas
        self.assertEqual(self.core.stats(), erneut.stats())
        erneut.close()

    def test_fremdschluessel_loescht_events_mit(self) -> None:
        item = self.core.create_item(SCHRAUBE, "Schraube M8", quantity=5)
        self.core.handle_scan(SCHRAUBE)
        with self.core._conn:  # noqa: SLF001
            self.core._conn.execute("DELETE FROM items WHERE id = ?", (item.id,))
        self.assertEqual([], self.core.history(item_id=item.id))


class TestSuche(CoreTest):
    def test_suche_ueber_barcode_name_kategorie_lagerort(self) -> None:
        """DoD 13: Inventar durchsuchen."""
        self.core.create_item(SCHRAUBE, "Schraube M8", category="Verbindungselemente",
                              quantity=12, location="Lager 2")
        self.core.create_item(MUTTER, "Mutter M8", category="Verbindungselemente",
                              quantity=6, location="Werkstatt")
        self.core.create_item("111222333", "Zollstock", category="Werkzeug",
                              quantity=2, location="Lager 2")
        self.assertEqual(1, len(self.core.list_items(SCHRAUBE)))
        self.assertEqual(1, len(self.core.list_items("zollstock")))
        self.assertEqual(2, len(self.core.list_items("Verbindungselemente")))
        self.assertEqual(2, len(self.core.list_items("Lager 2")))
        self.assertEqual(3, len(self.core.list_items("")))
        self.assertEqual(3, len(self.core.list_items(None)))

    def test_mehrwoerter_muessen_alle_treffen(self) -> None:
        self.core.create_item(SCHRAUBE, "Schraube M8", category="Verbindungselemente",
                              location="Lager 2")
        self.core.create_item(MUTTER, "Mutter M8", location="Werkstatt")
        self.assertEqual(["Schraube M8"], [i.name for i in self.core.list_items("m8 lager")])
        self.assertEqual([], self.core.list_items("m8 werkstatt zollstock"))

    def test_suche_ist_gross_kleinschreibungs_egal(self) -> None:
        self.core.create_item(SCHRAUBE, "Schraube M8")
        for query in ("SCHRAUBE", "schraube", "Schraube", "schrau"):
            self.assertEqual(1, len(self.core.list_items(query)), query)

    def test_prozent_und_unterstrich_sind_literale(self) -> None:
        self.core.create_item("ART-100", "Artikel 100 %")
        self.core.create_item("ART-200", "Artikel X_Y")
        self.assertEqual([], self.core.list_items("100%200"))
        self.assertEqual(1, len(self.core.list_items("100 %")))
        self.assertEqual(1, len(self.core.list_items("X_Y")))

    def test_ergebnis_ist_sortiert_und_begrenzt(self) -> None:
        for index in range(5):
            self.core.create_item(f"90000000000{index}", f"Zeta {index}")
        self.core.create_item("900000000009", "Alpha")
        namen = [i.name for i in self.core.list_items()]
        self.assertEqual("Alpha", namen[0])
        self.assertEqual(2, len(self.core.list_items(limit=2)))

    def test_kategorien_und_lagerorte_als_listen(self) -> None:
        self.artikel_anlegen()
        self.core.create_item("111222333", "Zollstock", category="Werkzeug", location="Lager 2")
        self.assertEqual(["Verbindungselemente", "Werkzeug"], self.core.categories())
        self.assertEqual(["Lager 2"], self.core.locations())


class TestHistorie(CoreTest):
    def test_historie_zeigt_uebergaenge_neueste_zuerst(self) -> None:
        """DoD 14 / Lastenheft § 6: `123456  Schraube M8  12 → 13`."""
        self.artikel_anlegen()
        self.core.handle_scan(SCHRAUBE)
        self.core.handle_scan(MUTTER)
        entries = self.core.history()
        self.assertEqual(["scan", "scan", "create", "create"], [e.type for e in entries])
        self.assertEqual(f"{MUTTER}  Mutter M8  6 → 7", entries[0].label())
        self.assertEqual(f"{SCHRAUBE}  Schraube M8  12 → 13", entries[1].label())

    def test_historie_mit_artikelnamen_auch_ohne_join_verlust(self) -> None:
        item = self.core.create_item(SCHRAUBE, "Schraube M8", quantity=1)
        self.core.update_item(item.id, name="Schraube M8 verzinkt")
        entry = self.core.history(limit=1)[0]
        self.assertEqual("Schraube M8 verzinkt", entry.itemName)

    def test_zeitstempel_sind_iso_utc_und_aufsteigend(self) -> None:
        self.artikel_anlegen()
        self.core.handle_scan(SCHRAUBE)
        times = [e.timestamp for e in reversed(self.core.history())]
        self.assertEqual(sorted(times), times)
        for stamp in times:
            self.assertRegex(stamp, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

    def test_begrenzung_je_artikel(self) -> None:
        self.artikel_anlegen()
        for _ in range(3):
            self.core.handle_scan(SCHRAUBE)
        # 1 create-Event + 3 Scans desselben Artikels
        self.assertEqual(4, len(self.core.history(item_id=self.core.find_by_barcode(SCHRAUBE).id)))
        self.assertEqual(2, len(self.core.history(limit=2)))


class TestEinstellungen(CoreTest):
    def test_grundausstattung_entspricht_lastenheft(self) -> None:
        settings = self.core.settings()
        for key, value in DEFAULT_SETTINGS.items():
            self.assertEqual(value, settings[key], key)
        self.assertEqual({"scannerProfile", "defaultLocation", "autoIncrement",
                          "soundEnabled", "vibrationEnabled"}, set(DEFAULT_SETTINGS))

    def test_werte_umschalten(self) -> None:
        self.core.set_setting("soundEnabled", False)
        self.assertEqual("0", self.core.setting("soundEnabled"))
        self.core.set_setting("scannerProfile", "honeywell-intent")
        self.assertEqual("honeywell-intent", self.core.setting("scannerProfile"))
        self.assertTrue(self.core.auto_increment)
        self.core.set_setting("autoIncrement", 0)
        self.assertFalse(self.core.auto_increment)

    def test_unbekannter_schluessel_liefert_default(self) -> None:
        self.assertEqual("", self.core.setting("gibtEsNicht"))
        self.assertEqual("fallback", self.core.setting("gibtEsNicht", "fallback"))


class TestBestandLoeschen(CoreTest):
    def test_alles_loeschen_behaelt_einstellungen(self) -> None:
        """DoD 17: Daten löschen (Vorbereitung für den Backup-Restore in Schritt 2)."""
        self.artikel_anlegen()
        self.core.handle_scan(SCHRAUBE)
        self.core.set_setting("defaultLocation", "Lager 9")
        before = self.core.clear_all()
        self.assertEqual(2, before["items"])
        self.assertEqual({"items": 0, "units": 0, "events": 0}, self.core.stats())
        self.assertEqual([], self.core.list_items())
        self.assertEqual([], self.core.history())
        self.assertEqual("Lager 9", self.core.setting("defaultLocation"))
        self.assertIsNone(self.core.find_by_barcode(SCHRAUBE))

    def test_nach_dem_loeschen_kann_derselbe_barcode_neu_angelegt_werden(self) -> None:
        self.core.create_item(SCHRAUBE, "Schraube M8", quantity=1)
        self.core.clear_all()
        item = self.core.create_item(SCHRAUBE, "Schraube M8 (neu)", quantity=7)
        self.assertEqual(7, item.quantity)
        self.assertEqual(1, item.id, "AUTOINCREMENT wurde zurückgesetzt")


class TestScanOutcome(unittest.TestCase):
    def test_datenklasse_traegt_den_pfad(self) -> None:
        unknown = ScanOutcome(kind="unknown", barcode="123")
        self.assertFalse(unknown.is_known)
        self.assertIsNone(unknown.item)
        opened = ScanOutcome(kind="open_item", barcode="123", autoIncrement=False)
        self.assertTrue(opened.is_known)


class TestSchemaSpalten(CoreTest):
    def test_spalten_entsprechen_dem_lastenheft(self) -> None:
        self.assertEqual(["id", "barcode", "name", "description", "category", "quantity",
                          "unit", "location", "createdAt", "updatedAt"],
                         schema_columns("items"))
        self.assertEqual(["id", "itemId", "barcode", "type", "quantityBefore",
                          "quantityAfter", "source", "timestamp"],
                         schema_columns("inventory_events"))
        self.assertEqual(["key", "value"], schema_columns("app_settings"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
