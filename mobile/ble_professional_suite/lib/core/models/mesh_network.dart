// lib/core/models/mesh_network.dart
// Mesh-Modelle: Netzwerk, Knoten, Modelle (Persistenz-fähig als JSON).
import 'package:flutter/foundation.dart';

enum MeshNodeRole { relay, proxy, friend, lowPower }

extension MeshNodeRoleX on MeshNodeRole {
  String get label => switch (this) {
        MeshNodeRole.relay => 'Relay',
        MeshNodeRole.proxy => 'Proxy',
        MeshNodeRole.friend => 'Friend',
        MeshNodeRole.lowPower => 'Low Power',
      };
}

@immutable
class MeshModel {
  final String id; // z. B. "0x1000" (Generic OnOff Server)
  final String name;
  final bool subscribed;

  const MeshModel({required this.id, required this.name, this.subscribed = false});
}

@immutable
class MeshNodeInfo {
  final String id;
  final String name;
  final int unicastAddress;
  final MeshNodeRole role;
  final int elementCount;
  final List<String> models;
  final int rssi;
  final int battery;
  final bool online;
  final String pub;
  final String sub;
  final int ttl;

  const MeshNodeInfo({
    required this.id,
    required this.name,
    required this.unicastAddress,
    this.role = MeshNodeRole.relay,
    this.elementCount = 1,
    this.models = const [],
    this.rssi = 0,
    this.battery = 100,
    this.online = true,
    this.pub = '',
    this.sub = '',
    this.ttl = 4,
  });

  MeshNodeInfo copyWith({bool? online, int? rssi, int? battery, String? pub, String? sub}) =>
      MeshNodeInfo(
        id: id,
        name: name,
        unicastAddress: unicastAddress,
        role: role,
        elementCount: elementCount,
        models: models,
        rssi: rssi ?? this.rssi,
        battery: battery ?? this.battery,
        online: online ?? this.online,
        pub: pub ?? this.pub,
        sub: sub ?? this.sub,
        ttl: ttl,
      );
}

@immutable
class MeshNetworkInfo {
  final String id;
  final String name;
  final String passphrase;
  final List<MeshNodeInfo> nodes;
  final DateTime createdAt;

  const MeshNetworkInfo({
    required this.id,
    required this.name,
    required this.passphrase,
    this.nodes = const [],
    required this.createdAt,
  });
}
