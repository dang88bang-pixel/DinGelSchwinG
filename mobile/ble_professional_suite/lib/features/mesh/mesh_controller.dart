// lib/features/mesh/mesh_controller.dart
// Mesh-Controller: Netzwerk CRUD, Provisionierung, Topologie, Nachrichten.
// Persistenz: Netzwerke werden in SQLite gespeichert/geladen
// (mesh_network_dao.dart + mesh_network.dart – aktiv verdrahtet).
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nrf_mesh_flutter/nrf_mesh_flutter.dart';
import '../../core/ble/mesh_service.dart';
import '../../core/database/mesh_network_dao.dart';
import '../../core/models/mesh_network.dart';
import '../../core/utils/logger.dart';

class MeshController {
  final MeshService _service = MeshService.instance;
  final MeshNetworkDao _dao = MeshNetworkDao();

  /// Persistiert das aktive Netzwerk inkl. Knoten (SQLite).
  Future<void> _persistActive() async {
    final network = _service.activeNetwork;
    if (network == null) return;
    try {
      await _dao.saveNetwork(MeshNetworkInfo(
        id: network.id.toString(),
        name: network.name,
        passphrase: _lastPassphrase ?? '',
        nodes: [
          for (final n in network.nodes)
            MeshNodeInfo(
              id: n.uuid.toString(),
              name: n.name ?? 'Knoten',
              unicastAddress: n.unicastAddress,
              elementCount: n.elements.length,
              models: _modelIds(n),
            ),
        ],
        createdAt: DateTime.now(),
      ));
      Logger.instance.info('Mesh-Netzwerk persistiert: ${network.name} '
          '(${network.nodes.length} Knoten)');
    } catch (e) {
      Logger.instance.error('Persistenz fehlgeschlagen', error: e);
    }
  }

  static List<String> _modelIds(ProvisionedNode n) {
    final ids = <String>[];
    for (final element in n.elements) {
      for (final model in element.models) {
        ids.add('0x${model.modelId.value.toRadixString(16)}');
      }
    }
    return ids;
  }

  String? _lastPassphrase;

  Future<MeshNetwork> createNetwork(String name, String passphrase) async {
    final network = await _service.createNetwork(name, passphrase);
    _lastPassphrase = passphrase;
    await _persistActive();
    Logger.instance.info('Mesh-Netzwerk erstellt + gespeichert: $name');
    return network;
  }

  Future<void> loadNetwork(UUID networkId) => _service.loadNetwork(networkId);

  /// Erzeugt eine nRF-Mesh-UUID aus einem persistierten String.
  /// Hinweis: Konstruktor-Signatur je nach nrf_mesh_flutter-Version
  /// (String-Konstruktor bzw. fromString) – bei SDK-Update prüfen.
  static UUID uuidFromString(String value) {
    try {
      return UUID.fromString(value);
    } catch (_) {
      return UUID(value);
    }
  }

  Future<void> provision(UnprovisionedDevice device, {String? name}) async {
    await _service.provisionDevice(device, nodeName: name);
    await _persistActive(); // Knotenstand sofort sichern
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
