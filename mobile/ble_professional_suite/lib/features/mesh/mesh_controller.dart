// lib/features/mesh/mesh_controller.dart
// Mesh-Controller: Netzwerk CRUD, Provisionierung, Topologie, Nachrichten.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nrf_mesh_flutter/nrf_mesh_flutter.dart';
import '../../core/ble/mesh_service.dart';
import '../../core/utils/logger.dart';

class MeshController {
  final MeshService _service = MeshService.instance;

  Future<MeshNetwork> createNetwork(String name, String passphrase) async {
    final network = await _service.createNetwork(name, passphrase);
    Logger.instance.info('Mesh-Netzwerk erstellt: $name');
    return network;
  }

  Future<void> loadNetwork(UUID networkId) => _service.loadNetwork(networkId);

  Future<void> provision(UnprovisionedDevice device, {String? name}) async {
    await _service.provisionDevice(device, nodeName: name);
  }

  Future<List<UnprovisionedDevice>> scanForUnprovisioned() =>
      _service.scanForUnprovisioned();

  Future<void> sendOnOff(int address, bool on) async {
    // Generic OnOff Set (Opcode 0x8202, 2 Bytes + Transaktions-ID)
    final message = Message(
      opcode: 0x8202,
      data: [on ? 1 : 0, 0],
    );
    await _service.sendMessage(address, message);
  }

  Future<void> refreshTopology() async {
    // Heartbeats der Knoten neu anfordern; Stream-Update erfolgt über
    // nodeUpdates/heartbeatUpdates.
    Logger.instance.info('Topologie wird aktualisiert…');
  }
}

final meshControllerProvider =
    Provider<MeshController>((ref) => MeshController());
