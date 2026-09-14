import 'package:dingelag/services/scanner/scan_buffer.dart';
import 'package:flutter_test/flutter_test.dart';

/// Der Scanner-Puffer ist die erste Verteidigungslinie gegen Fremdinput:
/// Handgetipptes, abgerissene Ketten und Tippfehler dürfen keinen Bestand
/// verändern.
void main() {
  group('ScanBuffer', () {
    test('sammelt Zeichen bis Enter und liefert den Barcode', () {
      final DateTime stamp = DateTime.utc(2026, 1, 1, 8);
      final ScanBuffer buffer = ScanBuffer(clock: () => stamp);

      for (final String char in '4006381333931'.split('')) {
        buffer.add(char);
      }
      expect(buffer.current, '4006381333931');
      expect(buffer.length, 13);
      expect(buffer.submit(), '4006381333931');
      expect(buffer.isEmpty, isTrue);
    });

    test('Enter ohne Inhalt ist ein Leerschlag, kein Fehler', () {
      final ScanBuffer buffer = ScanBuffer(clock: () => DateTime.utc(2026, 1, 1));
      buffer.lastError = 'Altlast';
      expect(buffer.submit(), isNull);
      expect(buffer.lastError, isNull);
    });

    test('zu kurze Eingabe wird abgelehnt und begründet', () {
      final ScanBuffer buffer = ScanBuffer(
        clock: () => DateTime.utc(2026, 1, 1),
        minLength: 3,
      );
      buffer
        ..add('1')
        ..add('2');
      expect(buffer.submit(), isNull);
      expect(buffer.lastError, contains('zu kurz'));
      expect(buffer.isEmpty, isTrue);
    });

    test('ungerissene Kette innerhalb des Zeitfensters bleibt ganz', () {
      DateTime now = DateTime.utc(2026, 1, 1);
      final ScanBuffer buffer = ScanBuffer(
        clock: () => now,
        maxGap: const Duration(milliseconds: 120),
      );

      buffer.add('A');
      now = now.add(const Duration(milliseconds: 40));
      buffer.add('R');
      now = now.add(const Duration(milliseconds: 40));
      buffer.add('T');

      expect(buffer.current, 'ART');
      expect(buffer.submit(), 'ART');
    });

    test('reißt die Kette ab, wird der Rest verworfen', () {
      DateTime now = DateTime.utc(2026, 1, 1);
      final ScanBuffer buffer = ScanBuffer(
        clock: () => now,
        maxGap: const Duration(milliseconds: 120),
      );

      buffer.add('1');
      now = now.add(const Duration(seconds: 3)); // Pause: jemand tippt selbst
      buffer.add('2');

      expect(buffer.current, '2');
      expect(buffer.submit(), isNull); // zu kurz
      expect(buffer.lastError, contains('zu kurz'));
    });

    test('explizite Zeitpunkte funktionieren ohne Uhr', () {
      final ScanBuffer buffer = ScanBuffer();
      final DateTime start = DateTime.utc(2026, 1, 1);

      buffer.add('A', at: start);
      buffer.add('B', at: start.add(const Duration(milliseconds: 10)));
      buffer.add('C', at: start.add(const Duration(milliseconds: 20)));
      expect(buffer.submit(at: start.add(const Duration(milliseconds: 25))),
          'ABC');

      buffer.add('X', at: start);
      buffer.add('Y', at: start.add(const Duration(seconds: 5)));
      expect(buffer.current, 'Y');
    });

    test('Zeichen außerhalb des Barcode-Vorrats werden beim Senden abgelehnt',
        () {
      final ScanBuffer buffer = ScanBuffer(clock: () => DateTime.utc(2026, 1, 1));
      for (final String char in 'ART#01'.split('')) {
        buffer.add(char);
      }
      expect(buffer.submit(), isNull);
      expect(buffer.lastError, contains('unerlaubte Zeichen'));
    });

    test('überlange Eingabe wird gekappt statt gesammelt', () {
      final ScanBuffer buffer = ScanBuffer(
        clock: () => DateTime.utc(2026, 1, 1),
        maxLength: 5,
        minLength: 3,
      );
      for (final String char in 'ABCDEFG'.split('')) {
        buffer.add(char);
      }
      expect(buffer.current, '');
      expect(buffer.lastError, contains('länger als 5'));
      expect(buffer.submit(), isNull);
      expect(buffer.lastError, contains('länger als 5'));
    });

    test('clear leert den Puffer, z. B. beim Bildschirmwechsel', () {
      final ScanBuffer buffer = ScanBuffer(clock: () => DateTime.utc(2026, 1, 1));
      buffer
        ..add('A')
        ..add('B')
        ..add('C');
      buffer.clear();
      expect(buffer.isEmpty, isTrue);
      expect(buffer.submit(), isNull);
    });
  });
}
