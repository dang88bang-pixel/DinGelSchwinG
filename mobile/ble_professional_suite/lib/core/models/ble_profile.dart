// lib/core/models/ble_profile.dart
// Konfigurationsprofil: Liste von Schritten, die auf Geräte angewendet werden.
import 'package:flutter/foundation.dart';
import 'ble_device.dart';

enum ConfigStepType {
  gattWrite,
  gattRead,
  notifyOn,
  mtu,
  pair,
  meshPub,
  meshSub,
  meshModel,
  ttl,
  verify,
}

extension ConfigStepTypeX on ConfigStepType {
  String get label => switch (this) {
        ConfigStepType.gattWrite => 'GATT-Write',
        ConfigStepType.gattRead => 'GATT-Read',
        ConfigStepType.notifyOn => 'Notifications',
        ConfigStepType.mtu => 'MTU',
        ConfigStepType.pair => 'Pairing',
        ConfigStepType.meshPub => 'Mesh-Pub',
        ConfigStepType.meshSub => 'Mesh-Sub',
        ConfigStepType.meshModel => 'Mesh-Modell',
        ConfigStepType.ttl => 'TTL',
        ConfigStepType.verify => 'Verifikation',
      };
}

@immutable
class ConfigStep {
  final ConfigStepType type;
  final String target;
  final String detail;
  final String? value;
  final bool critical;

  const ConfigStep({
    required this.type,
    required this.target,
    required this.detail,
    this.value,
    this.critical = false,
  });

  factory ConfigStep.fromJson(Map<String, dynamic> json) => ConfigStep(
        type: ConfigStepType.values.asNameMap()[json['type']] ?? ConfigStepType.verify,
        target: json['target'] as String? ?? '',
        detail: json['detail'] as String? ?? '',
        value: json['value'] as String?,
        critical: json['critical'] as bool? ?? false,
      );

  Map<String, dynamic> toJson() => {
        'type': type.name,
        'target': target,
        'detail': detail,
        if (value != null) 'value': value,
        'critical': critical,
      };
}

@immutable
class BleProfile {
  final String id;
  final String name;
  final BleDeviceClass deviceClass;
  final List<ConfigStep> steps;
  final DateTime createdAt;

  const BleProfile({
    required this.id,
    required this.name,
    required this.deviceClass,
    required this.steps,
    required this.createdAt,
  });

  factory BleProfile.fromJson(Map<String, dynamic> json) => BleProfile(
        id: json['id'] as String,
        name: json['name'] as String,
        deviceClass:
            BleDeviceClass.values.asNameMap()[json['deviceClass']] ?? BleDeviceClass.token,
        steps: (json['steps'] as List<dynamic>? ?? [])
            .map((e) => ConfigStep.fromJson(e as Map<String, dynamic>))
            .toList(),
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'deviceClass': deviceClass.name,
        'steps': steps.map((s) => s.toJson()).toList(),
        'createdAt': createdAt.toIso8601String(),
      };
}
