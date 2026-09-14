import 'package:dingelag/domain/validators.dart';
import 'package:flutter_test/flutter_test.dart';

/// Dieselben Grenzen wie `reference/tests/test_inventory_core.py` — nur eben
/// auf der Dart-Seite. Wenn hier etwas abweicht, liefert die App ein anderes
/// Verhalten als die geprüfte Referenz.
void main() {
  group('Barcode', () {
    test('nimmt EAN, interne Etiketten und Trennzeichen an', () {
      expect(validateBarcode('4006381333931'), '4006381333931');
      expect(validateBarcode('ART-001'), 'ART-001');
      expect(validateBarcode('LOC/R3:2'), 'LOC/R3:2');
      expect(validateBarcode('A+B.C_D'), 'A+B.C_D');
    });

    test('entfernt Rand-Leerzeichen, wie ein Scanner-Puffer es braucht', () {
      expect(validateBarcode('  4006381333931\n'), '4006381333931');
    });

    test('lehnt leer, zu lang, Leerzeichen und Fremdzeichen ab', () {
      expect(() => validateBarcode(''), throwsA(isA<ValidationException>()));
      expect(() => validateBarcode('   '), throwsA(isA<ValidationException>()));
      expect(() => validateBarcode('400 638'),
          throwsA(isA<ValidationException>()));
      expect(() => validateBarcode('a' * 65),
          throwsA(isA<ValidationException>()));
      expect(() => validateBarcode('CODE#1'),
          throwsA(isA<ValidationException>()));
      expect(() => validateBarcode('ART*7'),
          throwsA(isA<ValidationException>()));
    });

    test('Meldung nennt den Grund, nicht nur „ungültig"', () {
      expect(
        () => validateBarcode(''),
        throwsA(predicate<ValidationException>(
            (ValidationException e) => e.message.contains('Barcode'))),
      );
      expect(
        () => validateBarcode('CODE#1'),
        throwsA(predicate<ValidationException>(
            (ValidationException e) => e.message.contains('unerlaubte Zeichen'))),
      );
    });

    test('64 Zeichen sind erlaubt, 65 nicht', () {
      expect(validateBarcode('a' * 64).length, 64);
      expect(() => validateBarcode('a' * 65),
          throwsA(isA<ValidationException>()));
    });
  });

  group('Freitext', () {
    test('Name braucht mindestens ein Zeichen', () {
      expect(validateText('Schraube M8', 'name', minLength: 1, maxLength: 120),
          'Schraube M8');
      expect(
        () => validateText('  ', 'name', minLength: 1, maxLength: 120),
        throwsA(isA<ValidationException>()),
      );
    });

    test('Beschreibung darf leer bleiben', () {
      expect(
        validateText('', 'description', minLength: 0, maxLength: 500),
        '',
      );
    });

    test('Längenobergrenze wird geprüft', () {
      expect(
        () => validateText('x' * 121, 'name', minLength: 1, maxLength: 120),
        throwsA(isA<ValidationException>()),
      );
      expect(validateText('x' * 120, 'name', minLength: 1, maxLength: 120).length,
          120);
    });

    test('Zeilenumbrüche sind verboten (CSV-Export in Schritt 2)', () {
      expect(
        () => validateText('Schraube\nM8', 'name',
            minLength: 1, maxLength: 120),
        throwsA(isA<ValidationException>()),
      );
    });

    test('Feldname steht in der Meldung', () {
      expect(
        () => validateText('', 'Kategorie', minLength: 1, maxLength: 120),
        throwsA(predicate<ValidationException>(
            (ValidationException e) => e.message.contains('Kategorie'))),
      );
    });
  });

  group('Menge', () {
    test('ganze Zahlen aus Zahl und Text', () {
      expect(validateQuantity(12), 12);
      expect(validateQuantity('12'), 12);
      expect(validateQuantity('  7 '), 7);
      expect(validateQuantity(0), 0);
    });

    test('negativ, krumm und über dem Deckel werden abgelehnt', () {
      expect(() => validateQuantity(-1), throwsA(isA<ValidationException>()));
      expect(() => validateQuantity('12,5'),
          throwsA(isA<ValidationException>()));
      expect(() => validateQuantity('abc'),
          throwsA(isA<ValidationException>()));
      expect(() => validateQuantity(''),
          throwsA(isA<ValidationException>()));
      expect(() => validateQuantity(null),
          throwsA(isA<ValidationException>()));
      expect(() => validateQuantity(maxQuantity + 1),
          throwsA(isA<ValidationException>()));
    });

    test('Deckel selbst ist erlaubt', () {
      expect(validateQuantity(maxQuantity), maxQuantity);
    });
  });

  group('Suche', () {
    test('mehrere Begriffe werden zu Token', () {
      expect(searchTokens('  schraube   m8 '), <String>['schraube', 'm8']);
      expect(searchTokens(''), <String>[]);
    });

    test('LIKE-Sonderzeichen werden entschärft', () {
      expect(escapeLike('100%'), r'100\%');
      expect(escapeLike('ART_1'), r'ART\_1');
      expect(escapeLike(r'a\b'), r'a\\b');
    });
  });

  group('Zeitstempel', () {
    test('ISO-8601 in UTC mit Millisekunden — wie die Python-Referenz', () {
      expect(isoUtc(DateTime.utc(2026, 9, 13, 10, 42, 7, 123)),
          '2026-09-13T10:42:07.123Z');
      expect(isoUtc(DateTime.utc(2026, 9, 13, 10, 42, 7)),
          '2026-09-13T10:42:07.000Z');
    });

    test('lokale Zeit wird nach UTC gerechnet', () {
      final DateTime local = DateTime(2026, 9, 13, 12, 0, 0);
      expect(isoUtc(local).endsWith('Z'), isTrue);
      expect(isoUtc(local).contains('T'), isTrue);
    });
  });

  group('Einstellungen', () {
    test('autoIncrement: alles außer 0/false/leer gilt als an', () {
      expect(isAutoIncrementOn('1'), isTrue);
      expect(isAutoIncrementOn(null), isTrue);
      expect(isAutoIncrementOn('0'), isFalse);
      expect(isAutoIncrementOn('false'), isFalse);
      expect(isAutoIncrementOn(''), isFalse);
    });

    test('boolsche Werte werden als 1/0 gespeichert', () {
      expect(boolToSetting(true), '1');
      expect(boolToSetting(false), '0');
    });

    test('Startwerte entsprechen der Referenz', () {
      expect(defaultSettings['scannerProfile'], 'hid-keyboard-wedge');
      expect(defaultSettings['autoIncrement'], '1');
      expect(defaultSettings['soundEnabled'], '1');
      expect(defaultSettings['vibrationEnabled'], '1');
      expect(defaultSettings['defaultLocation'], '');
    });
  });

  group('Ereignisarten und Quellen', () {
    test('entsprechen dem Schema', () {
      expect(eventTypes, <String>[
        'scan',
        'manual',
        'create',
        'correction',
        'import',
        'delete',
      ]);
      expect(scanSources, <String>['hid', 'intent', 'ui', 'import']);
    });
  });

  group('EAN-Prüfziffer', () {
    test('gültige EAN-13 und EAN-8 werden erkannt', () {
      expect(looksLikeEan('4006381333931'), isTrue);
      expect(looksLikeEan('96385074'), isTrue);
    });

    test('falsche Prüfziffer und Kurzcodes fallen durch', () {
      expect(looksLikeEan('4006381333932'), isFalse);
      expect(looksLikeEan('ART-001'), isFalse);
      expect(looksLikeEan('12345'), isFalse);
    });
  });
}
