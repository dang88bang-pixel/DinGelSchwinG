import '../../domain/validators.dart';

/// Sammelt die Zeichen eines Tastatur-Keil-Scanners (HID) zu einem Barcode.
///
/// Der Honeywell CT45P schickt im Keyboard-Wedge-Modus genau das, was eine
/// Tastatur schicken würde: einzelne Zeichen, danach Enter. Zwei Regeln halten
/// Fremdinput vom Bestand fern:
///
/// 1. **Zeitfenster** — ein Scanner tippt in Millisekunden. Kommt ein Zeichen
///    deutlich später als das vorige, ist die Kette gerissen und der Puffer
///    wird geleert (Reste von Handeingabe zählen nicht als Barcode).
/// 2. **Mindestlänge** — unter [minLength] Zeichen gilt Enter als Tippfehler,
///    nicht als Scan.
///
/// Reines Dart ohne Flutter-Abhängigkeit: `test/scan_buffer_test.dart` prüft
/// das Verhalten, ohne dass ein Gerät oder Emulator läuft.
class ScanBuffer {
  ScanBuffer({
    this.minLength = 3,
    this.maxLength = 64,
    this.maxGap = const Duration(milliseconds: 120),
    DateTime Function()? clock,
  }) : _clock = clock;

  /// Kürzester noch akzeptierter Code (EAN-8 wäre 8, interne Etiketten kürzer).
  final int minLength;

  /// Längster noch gesammelter Code — danach wird verworfen statt gesammelt.
  final int maxLength;

  /// Größter Abstand zwischen zwei Zeichen, der noch als zusammenhängender
  /// Scan gilt.
  final Duration maxGap;

  final DateTime Function()? _clock;
  final StringBuffer _buffer = StringBuffer();
  DateTime? _lastKey;

  /// Letzte Ablehnung — die UI zeigt sie, statt stumm zu verwerfen.
  String? lastError;

  String get current => _buffer.toString();

  int get length => _buffer.length;

  bool get isEmpty => _buffer.isEmpty;

  /// Gekippt, sobald eine Kette [maxLength] überschreitet: Bis zum nächsten
  /// Enter (oder [clear]) wird der Rest verworfen, damit aus Müll kein neuer
  /// Barcode wird.
  bool _overflow = false;

  /// Ein Zeichen vom Scanner. [at] ist nur für Tests gesetzt.
  void add(String character, {DateTime? at}) {
    final DateTime stamp = at ?? _now();
    if (_lastKey != null && stamp.difference(_lastKey!) > maxGap) {
      _reset('Zeitfenster gerissen');
    }
    _lastKey = stamp;
    if (character.isEmpty) {
      return;
    }
    if (_overflow) {
      return;
    }
    if (_buffer.length >= maxLength) {
      _buffer.clear();
      _overflow = true;
      lastError = 'Eingabe länger als $maxLength Zeichen';
      return;
    }
    _buffer.write(character);
  }

  /// Enter vom Scanner: liefert den Barcode oder null, wenn die Kette zu kurz,
  /// zu lang oder ungültig war. Der Puffer ist danach immer leer.
  String? submit({DateTime? at}) {
    final DateTime stamp = at ?? _now();
    final String candidate = _buffer.toString();
    final bool overflowed = _overflow;
    _buffer.clear();
    _overflow = false;
    _lastKey = stamp;

    if (overflowed) {
      lastError ??= 'Eingabe länger als $maxLength Zeichen';
      return null;
    }
    if (candidate.isEmpty) {
      lastError = null; // Enter ohne Inhalt ist kein Fehler, nur ein Leerschlag.
      return null;
    }
    if (candidate.length < minLength) {
      lastError = 'Eingabe zu kurz für einen Barcode (${candidate.length} '
          'Zeichen, mindestens $minLength).';
      return null;
    }
    try {
      lastError = null;
      return validateBarcode(candidate);
    } on ValidationException catch (error) {
      lastError = error.message;
      return null;
    }
  }

  /// Puffer leeren, z. B. beim Wechsel des Bildschirms.
  void clear() => _reset(null);

  void _reset(String? reason) {
    _buffer.clear();
    _overflow = false;
    if (reason != null) {
      lastError = reason;
    }
  }

  DateTime _now() => _clock == null ? DateTime.now() : _clock();
}
