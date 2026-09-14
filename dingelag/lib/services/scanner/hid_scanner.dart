import 'dart:async';

import 'package:flutter/services.dart';

import 'scan_buffer.dart';

/// Zeichen, die ein Barcode enthalten darf (gleiche Menge wie
/// `barcodePattern`) — alles andere wird nicht geschluckt, sondern an Flutter
/// weitergereicht, damit Dialoge und Textfelder bedienbar bleiben.
final RegExp _barcodeChar = RegExp(r'^[A-Za-z0-9._:+/-]$');

/// Nimmt die Ausgabe eines HID-Scanners entgegen (Honeywell CT45P im
/// Keyboard-Wedge-Modus) und macht daraus Barcodes.
///
/// Warum global statt Textfeld? Im Lager läuft die App auf einem Scanner, der
/// ohne Fokus-Tipperei arbeitet: Gerät einschalten, scannen, Menge stimmt.
/// Der Handler hängt deshalb an `HardwareKeyboard` und meldet fertige Codes
/// über [barcodes]. Während ein Formular offen ist, pausiert die UI den
/// Scanner ([pause]), damit Handeingaben nicht doppelt ankommen.
///
/// Der Honeywell-Intent (`com.honeywell.aidc.ACTION_DECODED_DATA`) ist ein
/// eigener, klar getrennter Schritt — V0.1 läuft ohne Geräte-SDK-Annahmen.
class HidScanner {
  HidScanner({ScanBuffer? buffer}) : buffer = buffer ?? ScanBuffer();

  /// Zeichenketten-Sammler mit Zeitfenster- und Längenregeln.
  final ScanBuffer buffer;

  final StreamController<String> _codes = StreamController<String>.broadcast();
  final StreamController<String> _rejects = StreamController<String>.broadcast();

  /// Fertige Barcodes (ein Wert pro Enter-Taste).
  Stream<String> get barcodes => _codes.stream;

  /// Ablehnungsgründe — für die Statuszeile, nicht als Dialog.
  Stream<String> get rejections => _rejects.stream;

  bool _attached = false;
  bool _paused = false;

  bool get isAttached => _attached;

  bool get isPaused => _paused;

  /// Hängt den Handler an die Hardware-Tastatur.
  void attach() {
    if (_attached) {
      return;
    }
    HardwareKeyboard.instance.addHandler(onKeyEvent);
    _attached = true;
  }

  /// Löst den Handler wieder ab (Bildschirmwechsel, App-Ende).
  void detach() {
    if (!_attached) {
      return;
    }
    HardwareKeyboard.instance.removeHandler(onKeyEvent);
    _attached = false;
  }

  /// Scanner vorübergehend ignorieren, z. B. während eines Formulars.
  void pause() {
    _paused = true;
    buffer.clear();
  }

  void resume() {
    _paused = false;
    buffer.clear();
  }

  /// Ein Tastaturereignis prüfen. Öffentlich, weil es zwei Quellen gibt:
  /// die Hardware-Tastatur (hier angemeldet über [attach]) und in Schritt 2
  /// der Honeywell-Intent, der fertige Zeichenketten liefert.
  ///
  /// Rückgabe `true` heißt „behandelt": Das Ereignis geht nicht weiter an
  /// Textfelder. Genau deshalb pausiert die UI den Scanner, solange ein
  /// Formular offen ist.
  bool onKeyEvent(KeyEvent event) {
    if (_paused || event is KeyUpEvent || event is KeyRepeatEvent) {
      return false; // nicht behandelt → Flutter/Textfeld bekommt das Ereignis
    }

    final bool isEnter = event.logicalKey == LogicalKeyboardKey.enter ||
        event.logicalKey == LogicalKeyboardKey.numpadEnter;
    if (isEnter) {
      final String? code = buffer.submit();
      if (code == null) {
        final String? reason = buffer.lastError;
        if (reason != null && !_rejects.isClosed) {
          _rejects.add(reason);
        }
      } else if (!_codes.isClosed) {
        _codes.add(code);
      }
      return true; // Enter gehört dem Scan, nicht einem offenen Formular
    }

    final String? character = event.character;
    if (character == null || character.isEmpty) {
      return false;
    }
    if (!_barcodeChar.hasMatch(character)) {
      return false;
    }
    buffer.add(character);
    return true;
  }

  Future<void> dispose() async {
    detach();
    await _codes.close();
    await _rejects.close();
  }
}
