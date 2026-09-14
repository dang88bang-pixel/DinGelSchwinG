import 'dart:async';

import '../../domain/validators.dart';
import '../../models/scan_outcome.dart';
import 'hid_scanner.dart';

/// Verarbeitet einen Roh-Barcode (HID oder manuelle Eingabe) zu einem Ergebnis.
typedef ScanHandler = Future<ScanOutcome> Function(
  String barcode, {
  String source,
});

/// Was die UI nach einem Scan zeigen soll: Ergebnis **oder** Grund.
class ScanMessage {
  const ScanMessage.ok(this.outcome) : error = null;

  const ScanMessage.failed(this.error) : outcome = null;

  final ScanOutcome? outcome;
  final String? error;

  bool get isOk => outcome != null;

  /// Text für SnackBar/Statuszeile — in beiden Fällen vorhanden.
  String get text {
    final ScanOutcome? result = outcome;
    if (result != null) {
      return result.message;
    }
    return error ?? 'Scan konnte nicht verarbeitet werden.';
  }

  @override
  String toString() => isOk ? 'ScanMessage.ok($outcome)' : 'ScanMessage($error)';
}

/// Verbindet Scanner-Hardware und Inventur-Kern.
///
/// Zwei Eingänge, ein Ausgang: Barcodes aus dem HID-Keil ([HidScanner]) und
/// manuelle Eingaben ([submit]) landen als [ScanMessage] im selben Stream.
/// Die Verarbeitung ist **seriell** — ein doppelt auslösender Scanner darf
/// keinen Scan verlieren und keine Menge überspringen.
class ScannerService {
  ScannerService({
    required this.handler,
    HidScanner? hid,
    this.defaultSource = 'hid',
  }) : hid = hid ?? HidScanner();

  /// Wird pro Barcode aufgerufen (in der App: `InventoryRepository.handleScan`).
  final ScanHandler handler;

  final HidScanner hid;

  /// Quelle für HID-Codes; manuelle Eingaben melden `ui`.
  final String defaultSource;

  final StreamController<ScanMessage> _messages =
      StreamController<ScanMessage>.broadcast();
  StreamSubscription<String>? _codeSubscription;
  StreamSubscription<String>? _rejectSubscription;
  Future<void> _queue = Future<void>.value();
  int _pending = 0;

  /// Ergebnisse und Fehlermeldungen, neueste zuletzt.
  Stream<ScanMessage> get messages => _messages.stream;

  /// Anzahl wartender Scans (UI zeigt „verarbeite …" ab 1).
  int get pending => _pending;

  bool get isListening => _codeSubscription != null;

  /// HID-Eingaben annehmen.
  void start() {
    hid.attach();
    _codeSubscription ??= hid.barcodes.listen(
      (String barcode) => submit(barcode, source: defaultSource),
    );
    _rejectSubscription ??= hid.rejections.listen((String reason) {
      if (!_messages.isClosed) {
        _messages.add(ScanMessage.failed(reason));
      }
    });
  }

  /// HID-Eingaben ignorieren (Bildschirmwechsel, Formular offen).
  void stop() {
    hid.detach();
    _codeSubscription?.cancel();
    _codeSubscription = null;
    _rejectSubscription?.cancel();
    _rejectSubscription = null;
  }

  /// Einen Barcode verarbeiten — aus dem Scanner oder aus einem Formular.
  Future<ScanMessage> submit(String barcode, {String? source}) {
    final Completer<ScanMessage> completer = Completer<ScanMessage>();
    final String used = source ?? defaultSource;
    _pending++;
    _queue = _queue.then((_) => _process(barcode, used, completer));
    return completer.future;
  }

  Future<void> _process(
    String barcode,
    String source,
    Completer<ScanMessage> completer,
  ) async {
    ScanMessage message;
    try {
      message = ScanMessage.ok(await handler(barcode, source: source));
    } catch (error) {
      message = ScanMessage.failed(describe(error));
    }
    _pending--;
    if (!_messages.isClosed) {
      _messages.add(message);
    }
    if (!completer.isCompleted) {
      completer.complete(message);
    }
  }

  Future<void> dispose() async {
    stop();
    await hid.dispose();
    await _messages.close();
  }
}

/// Fehler in einen Satz übersetzen, den man im Lager versteht.
String describe(Object error) {
  if (error is ValidationException) {
    return error.message;
  }
  if (error is DuplicateBarcodeException) {
    return error.message;
  }
  if (error is UnknownItemException) {
    return error.message;
  }
  return 'Unerwarteter Fehler: $error';
}
