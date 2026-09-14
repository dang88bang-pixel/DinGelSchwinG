import 'package:flutter/services.dart';

/// Rückmeldung nach einem Scan: Ton und/oder Vibration.
///
/// Bewusst ohne Zusatzpakete — `SystemSound` und `HapticFeedback` aus
/// `package:flutter/services` reichen für das, was im Lager zählt: merken,
/// dass der Scan angekommen ist, ohne aufs Display zu schauen.
/// Beide Schalter stehen in `app_settings` (`soundEnabled`,
/// `vibrationEnabled`) und werden hier ausgewertet.
class ScanFeedback {
  const ScanFeedback({this.enabled = true});

  /// In Tests auf `false`, damit keine Plattformkanäle angesprochen werden.
  final bool enabled;

  /// Kurze Bestätigung; [success] unterscheidet „gezählt" von „Fehler".
  Future<void> play({
    required bool success,
    bool sound = true,
    bool vibration = true,
  }) async {
    if (!enabled) {
      return;
    }
    try {
      if (sound) {
        await SystemSound.play(SystemSoundType.click);
      }
      if (vibration) {
        if (success) {
          await HapticFeedback.lightImpact();
        } else {
          await HapticFeedback.heavyImpact();
        }
      }
    } catch (_) {
      // Kein Ton-/Vibrationsdienst (Desktop, Web, stummes Gerät) — der Scan
      // ist trotzdem gespeichert, also kein Grund für eine Fehlermeldung.
    }
  }
}
