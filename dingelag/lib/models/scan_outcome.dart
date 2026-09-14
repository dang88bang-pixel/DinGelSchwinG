import 'inventory_event.dart';
import 'item.dart';

/// Was ein Scan bewirkt hat (Lastenheft § 4, Tabelle „Scan-Verhalten").
enum ScanKind {
  /// Bekannter Code + `autoIncrement` an → Menge +1, Ereignis geschrieben.
  incremented,

  /// Bekannter Code + `autoIncrement` aus → Artikel geöffnet, kein Schreiben.
  opened,

  /// Unbekannter Code → nichts geschrieben, UI fragt nach dem Neuanlegen.
  unknown,
}

/// Ergebnis eines Scans: der UI reicht dieses Objekt, um sofort zu reagieren,
/// ohne selbst in die Datenbank zu schauen.
class ScanOutcome {
  const ScanOutcome({
    required this.kind,
    required this.barcode,
    this.item,
    this.event,
    this.autoIncrement = true,
  });

  final ScanKind kind;
  final String barcode;
  final Item? item;
  final InventoryEvent? event;
  final bool autoIncrement;

  bool get isKnown => kind != ScanKind.unknown;
  bool get isUnknown => kind == ScanKind.unknown;

  /// Kurzmeldung für die SnackBar.
  String get message {
    final Item? found = item;
    switch (kind) {
      case ScanKind.incremented:
        return found == null
            ? '$barcode erfasst'
            : '${found.name}: ${event?.quantityBefore ?? 0} → '
                '${found.quantity} ${found.unit}';
      case ScanKind.opened:
        return found == null
            ? '$barcode geöffnet'
            : '${found.name} geöffnet (${found.quantity} ${found.unit})';
      case ScanKind.unknown:
        return 'Unbekannter Code: $barcode — neu anlegen?';
    }
  }

  @override
  String toString() => 'ScanOutcome(${kind.name}, $barcode)';
}
