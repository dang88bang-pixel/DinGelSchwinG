// lib/providers/mesh_provider.dart
// Riverpod-Provider für Mesh-Netzwerke, Knoten und Provisionierung.
// Alle Streams sind an MeshService gebunden (echte nRF-Mesh-Operationen).
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nrf_mesh_flutter/nrf_mesh_flutter.dart';
import '../core/ble/mesh_service.dart';

final meshServiceProvider = Provider<MeshService>((ref) => MeshService.instance);

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
