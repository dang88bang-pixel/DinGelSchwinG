// lib/features/scan/scan_controller.dart
// Scan-Controller: startet/stoppt den BLE-Scan und aktualisiert den Status.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/ble/ble_service.dart';
import '../../core/utils/logger.dart';

class ScanController extends StateNotifier<bool> {
  ScanController() : super(BLEService.instance.isScanning);

  Future<void> startScan({Duration? timeout}) async {
    try {
      await BLEService.instance.startScan(timeout: timeout);
      state = true;
    } catch (e) {
      Logger.instance.error('Scan konnte nicht starten', error: e);
      rethrow;
    }
  }

  void stopScan() {
    BLEService.instance.stopScan();
    state = false;
  }
}

final scanControllerProvider =
    StateNotifierProvider<ScanController, bool>((ref) => ScanController());
