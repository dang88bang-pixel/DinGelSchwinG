// lib/providers/mesh_provider.dart
// Riverpod-Provider für Mesh-Netzwerke, Knoten und Provisionierung.
// Alle Streams sind an MeshService gebunden (echte nRF-Mesh-Operationen);
// gespeicherte Netzwerke kommen aus SQLite (mesh_network_dao, aktiv).
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nrf_mesh_flutter/nrf_mesh_flutter.dart';
import '../core/ble/mesh_service.dart';
import '../core/database/mesh_network_dao.dart';
import '../core/models/mesh_network.dart';

final meshServiceProvider = Provider<MeshService>((ref) => MeshService.instance);

final meshNetworkDaoProvider = Provider<MeshNetworkDao>((ref) => MeshNetworkDao());

/// Aktiv geladene Netzwerke aus der SQLite-Persistenz (invalidate zum Neuladen).
final savedMeshNetworksProvider = FutureProvider<List<MeshNetworkInfo>>(
  (ref) => ref.watch(meshNetworkDaoProvider).getNetworks(),
);

/// Aktives Mesh-Netzwerk (Stream).
final activeMeshNetworkProvider = StreamProvider<MeshNetwork?>(
  (ref) => MeshService.instance.networkUpdates.map((n) => n),
);

/// Knotenliste des aktiven Netzwerks (Stream).
final meshNodesProvider = StreamProvider<List<ProvisionedNode>>(
  (ref) => MeshService.instance.nodeUpdates,
);

/// Unprovisionierte Geräte im Scan-Bereich (Push vom MeshService-Scan).
final unprovisionedDevicesProvider = StreamProvider<List<UnprovisionedDevice>>(
  (ref) => MeshService.instance.unprovisionedUpdates,
);

/// Heartbeat-Monitoring einzelner Knoten.
final meshHeartbeatProvider = StreamProvider<ProvisionedNode>(
  (ref) => MeshService.instance.heartbeatUpdates,
);
