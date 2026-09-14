/// Eingabeprüfung und Konstanten — **spiegelgleich zur Referenzimplementation**
/// in `reference/inventory_core.py`.
///
/// Warum doppelt? Die Flutter-App lässt sich in dieser Entwicklungsumgebung
/// nicht bauen (kein SDK), die Python-Referenz schon. Beide Dateien ziehen
/// dieselben Grenzen: `reference/tests/test_inventory_core.py` beweist das
/// Verhalten gegen eine echte SQLite-Datei, `test/validators_test.dart`
/// beweist, dass Dart dieselben Eingaben annimmt und ablehnt.
library;

/// Barcode-Zeichenvorrat: alphanumerisch plus die Trennzeichen, die EAN-13,
/// Code-128, QR und interne Etiketten (`ART-001`, `LOC/R3:2`) liefern.
/// 64 Zeichen Deckel, damit ein HID-Scanner keinen Wildtext einschleust.
final RegExp barcodePattern = RegExp(r'^[A-Za-z0-9._:+/-]{1,64}$');

/// Obergrenze der Menge. Werte darüber sind praktisch immer ein Tippfehler
/// (Doppelauslösung des Scanners, vertauschte Felder).
const int maxQuantity = 10000000;

/// Ereignisarten aus `schema/schema.sql` (`CHECK (type IN …)`).
const List<String> eventTypes = <String>[
  'scan',
  'manual',
  'create',
  'correction',
  'import',
  'delete',
];

/// Scan-Quellen aus `schema/schema.sql` (`CHECK (source IN …)`).
/// V0.1 benutzt `hid` (Tastatur-Keil) und `ui`; der Honeywell-Intent folgt.
const List<String> scanSources = <String>['hid', 'intent', 'ui', 'import'];

/// Startwerte für `app_settings` (Lastenheft § 3 `AppSettings`).
/// Dieselben Werte wie `DEFAULT_SETTINGS` in der Python-Referenz.
const Map<String, String> defaultSettings = <String, String>{
  'scannerProfile': 'hid-keyboard-wedge',
  'defaultLocation': '',
  'autoIncrement': '1',
  'soundEnabled': '1',
  'vibrationEnabled': '1',
};

/// Ungültige Eingabe — die UI zeigt [message] 1:1 als Fehlertext.
class ValidationException implements Exception {
  const ValidationException(this.message);

  final String message;

  @override
  String toString() => 'ValidationException: $message';
}

/// Barcode ist schon vergeben (ein Barcode = genau ein Artikel).
class DuplicateBarcodeException implements Exception {
  const DuplicateBarcodeException(this.barcode);

  final String barcode;

  String get message =>
      'Barcode $barcode ist bereits einem Artikel zugeordnet.';

  @override
  String toString() => 'DuplicateBarcodeException: $barcode';
}

/// Gesuchter Artikel existiert nicht (mehr).
class UnknownItemException implements Exception {
  const UnknownItemException(this.reference);

  final String reference;

  String get message => 'Artikel $reference existiert nicht.';

  @override
  String toString() => 'UnknownItemException: $reference';
}

/// Entfernt Rand- und wiederholte Leerzeichen (Suchanfragen, Mengen aus Text).
String sanitize(String raw) => raw.trim().replaceAll(RegExp(r'\s+'), ' ');

/// Prüft einen Barcode und gibt ihn bereinigt zurück.
///
/// Wirft [ValidationException] mit einer Meldung, die im Lager verständlich
/// ist — kein „invalid input".
String validateBarcode(String raw) {
  final String value = raw.trim();
  if (value.isEmpty) {
    throw const ValidationException('Barcode fehlt.');
  }
  if (!barcodePattern.hasMatch(value)) {
    final String shown = value.length > 40 ? value.substring(0, 40) : value;
    throw ValidationException(
        "Barcode '$shown' enthält unerlaubte Zeichen "
        '(erlaubt: A-Z a-z 0-9 . _ : + / - , max. 64 Zeichen).');
  }
  return value;
}

/// Prüft einen Freitext (Name, Beschreibung, Kategorie, Einheit, Ort).
///
/// [minLength] 0 heißt: Feld darf leer bleiben. Zeilenumbrüche sind verboten,
/// weil sie später im CSV-Export (Schritt 2) Zeilen aufbrechen würden.
String validateText(
  String raw,
  String field, {
  required int minLength,
  required int maxLength,
}) {
  final String value = raw.trim();
  if (value.length < minLength) {
    throw ValidationException(minLength > 1
        ? '$field ist zu kurz (mindestens $minLength Zeichen).'
        : '$field darf nicht leer sein.');
  }
  if (value.length > maxLength) {
    throw ValidationException('$field ist länger als $maxLength Zeichen.');
  }
  if (value.contains('\n') || value.contains('\r')) {
    throw ValidationException('$field darf keine Zeilenumbrüche enthalten.');
  }
  return value;
}

/// Mengenangabe: ganze Zahl, kein Minus, Deckel bei [maxQuantity].
int validateQuantity(Object? raw) {
  if (raw == null) {
    throw const ValidationException('Menge fehlt.');
  }
  int value;
  if (raw is int) {
    value = raw;
  } else if (raw is num) {
    value = raw.toInt();
  } else {
    final String text = sanitize(raw.toString());
    final int? parsed = int.tryParse(text);
    if (parsed == null) {
      throw ValidationException("Menge '$raw' ist keine ganze Zahl.");
    }
    value = parsed;
  }
  if (value < 0) {
    throw const ValidationException('Menge darf nicht negativ sein.');
  }
  if (value > maxQuantity) {
    throw ValidationException('Menge über $maxQuantity ist unplausibel.');
  }
  return value;
}

/// `LIKE`-Sonderzeichen entschärfen — das Repository nutzt `ESCAPE '\'`.
String escapeLike(String token) => token
    .replaceAll('\\', '\\\\')
    .replaceAll('%', r'\%')
    .replaceAll('_', r'\_');

/// Zerlegt eine Suchanfrage in Token (mehrere Begriffe = UND, § 5 Suche).
List<String> searchTokens(String query) => sanitize(query)
    .split(' ')
    .where((String token) => token.isNotEmpty)
    .toList(growable: false);

/// ISO-8601 in UTC mit Millisekunden — identisch zum Format der Python-
/// Referenz (`%Y-%m-%dT%H:%M:%S.%f[:-3] + 'Z'`), damit Backup-Dateien aus
/// beiden Welten mischbar sind.
String isoUtc(DateTime value) => value.toUtc().toIso8601String();

/// Jetzt als ISO-Stempel (UTC).
String isoUtcNow() => isoUtc(DateTime.now());

/// `autoIncrement`-Einstellung auswerten: alles außer `0`, `false` und leer
/// gilt als eingeschaltet (gleiche Regel wie die Referenz).
bool isAutoIncrementOn(String? stored) {
  final String value = stored ?? '1';
  return value != '0' && value != 'false' && value != '';
}

/// `'1'`/`'0'` für boolsche Einstellungen in `app_settings`.
String boolToSetting(bool value) => value ? '1' : '0';

/// Prüfziffer-Test für EAN-8/EAN-13 — **nur** als Hinweis in der UI, nie als
/// Sperre: Eigenetiketten sind kurz und trotzdem gültig.
bool looksLikeEan(String barcode) {
  final RegExp digits = RegExp(r'^\d{8}$|^\d{13}$');
  if (!digits.hasMatch(barcode)) {
    return false;
  }
  int sum = 0;
  final int last = barcode.length - 1;
  for (int i = 0; i < last; i++) {
    final int digit = int.parse(barcode[i]);
    // Gewicht 3 für Stellen mit ungeradem Abstand zur Prüfziffer.
    sum += (last - i).isOdd ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10 == int.parse(barcode[last]);
}
