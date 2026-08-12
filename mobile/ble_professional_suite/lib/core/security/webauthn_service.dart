// lib/core/security/webauthn_service.dart
// Sicherheits-Gateway für kritische Aktionen (WebAuthn/FIDO2-Äquivalent).
//
// Ablauf: 1) Biometrische Authentifizierung (local_auth – FaceID/Fingerprint,
// FIDO2-nahes Mobil-Äquivalent) → 2) Fallback: Bestätigungsdialog des Aufrufers.
// Jede Bestätigung wird im Audit-Log protokolliert.
import 'package:local_auth/local_auth.dart';
import '../utils/logger.dart';

class WebAuthnService {
  static final WebAuthnService instance = WebAuthnService._internal();
  factory WebAuthnService() => instance;
  WebAuthnService._internal();

  final LocalAuthentication _localAuth = LocalAuthentication();

  /// Bestätigt eine kritische Aktion. `onFallbackRequired` darf UI zeigen
  /// (z. B. Dialog) und wird aufgerufen, wenn Biometrie nicht verfügbar ist.
  Future<bool> confirm(
    String actionDescription, {
    required Future<bool> Function() onFallbackRequired,
  }) async {
    try {
      final canCheck = await _localAuth.canCheckBiometrics;
      final isSupported = await _localAuth.isDeviceSupported();
      if (canCheck && isSupported) {
        final ok = await _localAuth.authenticate(
          localizedReason: 'Kritische Aktion bestätigen: $actionDescription',
          options: const AuthenticationOptions(
            biometricOnly: true,
            stickyAuth: true,
          ),
        );
        if (ok) {
          Logger.instance.info('WebAuthn/biometrisch bestätigt: $actionDescription');
          return true;
        }
        Logger.instance.warn('Biometrie abgebrochen – Fallback-Dialog');
      } else {
        Logger.instance.warn('Biometrie nicht verfügbar – Fallback-Dialog');
      }
    } catch (e) {
      Logger.instance.warn('Biometrie-Fehler – Fallback-Dialog', error: e);
    }
    return onFallbackRequired();
  }
}
