// lib/core/ble/mesh_service.dart
// BLE Mesh-Integration (nRF Mesh SDK via nrf_mesh_flutter).
// Netzwerk-Erstellung mit zentralen Schlüsseln, Provisionierung,
// Pub/Sub-Konfiguration, Modell-Konfiguration, Nachrichtenversand.
import 'dart:async';
import 'package:nrf_mesh_flutter/nrf_mesh_flutter.dart';
import '../utils/logger.dart';

class MeshService {
  static final MeshService instance = MeshService._internal();
  factory MeshService() => instance;
  MeshService._internal();

  MeshManager? _meshManager;
  MeshNetwork? _activeNetwork;

  final _networkController = StreamController<MeshNetwork>.broadcast();
  final _nodeController = StreamController<List<ProvisionedNode>>.broadcast();
  final _heartbeatController = StreamController<ProvisionedNode>.broadcast();
  final _unprovisionedController =
      StreamController<List<UnprovisionedDevice>>.broadcast();

  Stream<MeshNetwork> get networkUpdates => _networkController.stream;
  Stream<List<ProvisionedNode>> get nodeUpdates => _nodeController.stream;

  /// Live-Heartbeats einzelner Knoten (Monitoring/Ausfall-Erkennung).
  Stream<ProvisionedNode> get heartbeatUpdates => _heartbeatController.stream;

  /// Ergebnisse der Unprovisioned-Scans (Push an UI/Agent).
  Stream<List<UnprovisionedDevice>> get unprovisionedUpdates =>
      _unprovisionedController.stream;

  Future<void> initialize() async {
    _meshManager = await MeshManager.initialize();
    Logger.instance.info('nRF Mesh initialisiert');
  }

  // === NETZWERK ===
  Future<MeshNetwork> createNetwork(String name, String passphrase) async {
    final manager = _meshManager ??
        (throw StateError('Mesh nicht initialisiert – initialize() aufrufen'));

    final network = await manager.createNetwork(
      name: name,
      passphrase: passphrase,
    );
    _activeNetwork = network;
    _networkController.add(network);
    Logger.instance.info('Mesh-Netzwerk erstellt: $name');
    return network;
  }

  Future<void> loadNetwork(UUID networkId) async {
    final manager = _meshManager ??
        (throw StateError('Mesh nicht initialisiert – initialize() aufrufen'));

    final network = await manager.loadNetwork(networkId);
    _activeNetwork = network;
    _networkController.add(network);
    Logger.instance.info('Mesh-Netzwerk geladen: ${network.name}');
  }

  // === PROVISIONIERUNG ===
  Future<ProvisionedNode> provisionDevice(
    UnprovisionedDevice device, {
    String? nodeName,
  }) async {
    final network = _activeNetwork ??
        (throw StateError('Kein aktives Mesh-Netzwerk'));

    final node = await network.provision(device);
    if (nodeName != null && nodeName.isNotEmpty) {
      await node.setName(nodeName);
    }
    _nodeController.add(network.nodes);
    Logger.instance.info('Knoten provisioniert: ${node.name ?? node.uuid}');
    return node;
  }

  Future<List<UnprovisionedDevice>> scanForUnprovisioned() async {
    final manager = _meshManager ??
        (throw StateError('Mesh nicht initialisiert – initialize() aufrufen'));
    final devices = await manager.scanForUnprovisioned();
    _unprovisionedController.add(List.unmodifiable(devices));
    Logger.instance.info('Unprovisioned-Scan: ${devices.length} Geräte gefunden');
    return devices;
  }

  /// Guard: aktives Netzwerk erforderlich (ohne ungenutzte lokale Variable).
  void _requireNetwork() {
    if (_activeNetwork == null) {
      throw StateError('Kein aktives Mesh-Netzwerk');
    }
  }

  // === KONFIGURATION ===
  Future<void> configureModel(
    ProvisionedNode node,
    int elementIndex,
    ModelId modelId, {
    int? publicationAddress,
    int? subscriptionAddress,
  }) async {
    _requireNetwork();
    final element = node.elements[elementIndex];
    final model = element.models.firstWhere((m) => m.modelId == modelId);

    if (publicationAddress != null) {
      await model.setPublicationAddress(publicationAddress);
      Logger.instance.info('Pub-Adresse gesetzt: '
          '${node.name ?? node.uuid} → 0x${publicationAddress.toRadixString(16)}');
    }
    if (subscriptionAddress != null) {
      await model.addSubscriptionAddress(subscriptionAddress);
      Logger.instance.info('Sub-Adresse gesetzt: '
          '${node.name ?? node.uuid} → 0x${subscriptionAddress.toRadixString(16)}');
    }
  }

  Future<void> setPublicationAddress(ProvisionedNode node, int address) async {
    _requireNetwork();
    for (final element in node.elements) {
      for (final model in element.models) {
        await model.setPublicationAddress(address);
      }
    }
  }

  Future<void> addSubscriptionAddress(ProvisionedNode node, int address) async {
    _requireNetwork();
    for (final element in node.elements) {
      for (final model in element.models) {
        await model.addSubscriptionAddress(address);
      }
    }
  }

  Future<void> setDefaultTtl(ProvisionedNode node, int ttl) async {
    _requireNetwork();
    await _activeNetwork!.setDefaultTtl(ttl);
    Logger.instance.info('TTL ${node.name ?? node.uuid} → $ttl');
  }

  // === NACHRICHTEN ===
  Future<void> sendMessage(int destinationAddress, Message message) async {
    _requireNetwork();
    await _activeNetwork!.sendMessage(destinationAddress, message);
    Logger.instance.info('Mesh-Nachricht → 0x'
        '${destinationAddress.toRadixString(16)}');
  }

  // === TOPOLOGIE / STATUS ===
  List<ProvisionedNode> get nodes => _activeNetwork?.nodes ?? [];
  MeshNetwork? get activeNetwork => _activeNetwork;

  void dispose() {
    _networkController.close();
    _nodeController.close();
    _heartbeatController.close();
    _unprovisionedController.close();
  }
}
