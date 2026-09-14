import 'dart:async';

import 'package:dingelag/services/scanner/hid_scanner.dart';
import 'package:dingelag/services/scanner/scan_buffer.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Der HID-Pfad des Honeywell CT45P: Zeichen kommen als Tastaturereignisse,
/// Enter beendet den Code. Diese Tests fahren die Ereignisse direkt in
/// [HidScanner.onKeyEvent] — dieselbe Stelle, an der die Hardware-Tastatur
/// (und ab Schritt 2 der Honeywell-Intent) einsetzt.
void main() {
  /// Feste Uhr, damit das Zeitfenster im Puffer nicht vom Testablauf abhängt.
  HidScanner scannerWithFixedClock({int minLength = 3}) {
    return HidScanner(
      buffer: ScanBuffer(
        clock: () => DateTime.utc(2026, 1, 1, 8),
        minLength: minLength,
      ),
    );
  }

  KeyDownEvent keyDown(String character) => KeyDownEvent(
        physicalKey: PhysicalKeyboardKey.any,
        logicalKey: LogicalKeyboardKey.keyA,
        character: character,
      );

  KeyDownEvent enter() => KeyDownEvent(
        physicalKey: PhysicalKeyboardKey.any,
        logicalKey: LogicalKeyboardKey.enter,
      );

  KeyDownEvent numpadEnter() => KeyDownEvent(
        physicalKey: PhysicalKeyboardKey.any,
        logicalKey: LogicalKeyboardKey.numpadEnter,
      );

  KeyUpEvent keyUp(String character) => KeyUpEvent(
        physicalKey: PhysicalKeyboardKey.any,
        logicalKey: LogicalKeyboardKey.keyA,
        character: character,
      );

  /// Zeichenkette wie ein Scanner einspielen.
  void type(HidScanner scanner, String code) {
    for (final String character in code.split('')) {
      scanner.onKeyEvent(keyDown(character));
    }
  }

  test('Code plus Enter ergibt genau einen Barcode', () async {
    final HidScanner scanner = scannerWithFixedClock();
    final List<String> received = <String>[];
    final StreamSubscription<String> subscription =
        scanner.barcodes.listen(received.add);

    type(scanner, '4006381333931');
    scanner.onKeyEvent(enter());
    await Future<void>.delayed(Duration.zero);

    expect(received, <String>['4006381333931']);
    await subscription.cancel();
    await scanner.dispose();
  });

  test('Ziffernblock-Enter beendet den Code genauso', () async {
    final HidScanner scanner = scannerWithFixedClock();
    final List<String> received = <String>[];
    final StreamSubscription<String> subscription =
        scanner.barcodes.listen(received.add);

    type(scanner, 'ART-001');
    scanner.onKeyEvent(numpadEnter());
    await Future<void>.delayed(Duration.zero);

    expect(received, <String>['ART-001']);
    await subscription.cancel();
    await scanner.dispose();
  });

  test('KeyUp und Tastenwiederholung zählen nicht doppelt', () async {
    final HidScanner scanner = scannerWithFixedClock();
    final List<String> received = <String>[];
    final StreamSubscription<String> subscription =
        scanner.barcodes.listen(received.add);

    type(scanner, 'ART-002');
    scanner.onKeyEvent(keyUp('2'));
    scanner.onKeyEvent(
      KeyRepeatEvent(
        physicalKey: PhysicalKeyboardKey.any,
        logicalKey: LogicalKeyboardKey.keyA,
        character: '2',
      ),
    );
    scanner.onKeyEvent(enter());
    await Future<void>.delayed(Duration.zero);

    expect(received, <String>['ART-002']);
    await subscription.cancel();
    await scanner.dispose();
  });

  test('zu kurze Eingabe meldet einen Grund statt einen Barcode', () async {
    final HidScanner scanner = scannerWithFixedClock();
    final List<String> received = <String>[];
    final List<String> rejections = <String>[];
    final StreamSubscription<String> codes =
        scanner.barcodes.listen(received.add);
    final StreamSubscription<String> rejects =
        scanner.rejections.listen(rejections.add);

    type(scanner, 'ab');
    final bool handled = scanner.onKeyEvent(enter());
    await Future<void>.delayed(Duration.zero);

    expect(handled, isTrue, reason: 'Enter gehört dem Scan');
    expect(received, isEmpty);
    expect(rejections.single, contains('zu kurz'));

    await codes.cancel();
    await rejects.cancel();
    await scanner.dispose();
  });

  test('Fremdzeichen gehen an Flutter weiter (Dialoge bleiben bedienbar)', () {
    final HidScanner scanner = scannerWithFixedClock();

    expect(scanner.onKeyEvent(keyDown('#')), isFalse);
    expect(scanner.onKeyEvent(keyDown(' ')), isFalse);
    expect(scanner.onKeyEvent(keyDown('€')), isFalse);
    expect(scanner.onKeyEvent(keyDown('a')), isTrue);
    expect(scanner.buffer.current, 'a');
  });

  test('Pause nimmt keine Zeichen an — Handeingabe im Formular bleibt heil',
      () async {
    final HidScanner scanner = scannerWithFixedClock();
    final List<String> received = <String>[];
    final StreamSubscription<String> subscription =
        scanner.barcodes.listen(received.add);

    type(scanner, 'ART');
    scanner.pause();
    expect(scanner.isPaused, isTrue);
    expect(scanner.buffer.isEmpty, isTrue, reason: 'Pause leert den Puffer');

    type(scanner, 'ART-003');
    scanner.onKeyEvent(enter());
    await Future<void>.delayed(Duration.zero);
    expect(received, isEmpty);

    scanner.resume();
    expect(scanner.isPaused, isFalse);
    type(scanner, 'ART-004');
    scanner.onKeyEvent(enter());
    await Future<void>.delayed(Duration.zero);
    expect(received, <String>['ART-004']);

    await subscription.cancel();
    await scanner.dispose();
  });

  test('An- und Abmelden an der Hardware-Tastatur ist idempotent', () {
    final HidScanner scanner = scannerWithFixedClock();
    expect(scanner.isAttached, isFalse);
    scanner
      ..attach()
      ..attach();
    expect(scanner.isAttached, isTrue);
    scanner
      ..detach()
      ..detach();
    expect(scanner.isAttached, isFalse);
  });

  test('zwei Scans hintereinander bleiben getrennt', () async {
    final HidScanner scanner = scannerWithFixedClock();
    final List<String> received = <String>[];
    final StreamSubscription<String> subscription =
        scanner.barcodes.listen(received.add);

    type(scanner, 'ART-005');
    scanner.onKeyEvent(enter());
    type(scanner, 'ART-006');
    scanner.onKeyEvent(enter());
    await Future<void>.delayed(Duration.zero);

    expect(received, <String>['ART-005', 'ART-006']);
    await subscription.cancel();
    await scanner.dispose();
  });
}
