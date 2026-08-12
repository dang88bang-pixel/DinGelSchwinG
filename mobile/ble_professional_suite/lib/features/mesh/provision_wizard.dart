// lib/features/mesh/provision_wizard.dart
// Wizard: nicht-provisionierte Geräte scannen und per Tap provisionieren.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nrf_mesh_flutter/nrf_mesh_flutter.dart';
import 'mesh_controller.dart';

class ProvisionWizard extends ConsumerStatefulWidget {
  const ProvisionWizard({super.key});

  @override
  ConsumerState<ProvisionWizard> createState() => _ProvisionWizardState();
}

class _ProvisionWizardState extends ConsumerState<ProvisionWizard> {
  List<UnprovisionedDevice> _devices = [];
  bool _scanning = false;
  String? _activeProvisionId;

  Future<void> _scan() async {
    setState(() => _scanning = true);
    try {
      final found = await ref.read(meshControllerProvider).scanForUnprovisioned();
      setState(() => _devices = found);
    } finally {
      setState(() => _scanning = false);
    }
  }

  Future<void> _provision(UnprovisionedDevice device) async {
    setState(() => _activeProvisionId = device.uuid.toString());
    try {
      await ref.read(meshControllerProvider).provision(device);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Knoten ${device.uuid} provisioniert')),
        );
        setState(() => _devices =
            _devices.where((d) => d.uuid != device.uuid).toList());
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Provisionierung fehlgeschlagen: $e')),
        );
      }
    } finally {
      setState(() => _activeProvisionId = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Knoten provisionieren'),
      content: SizedBox(
        width: 360,
        height: 320,
        child: Column(
          children: [
            FilledButton.icon(
              onPressed: _scanning ? null : _scan,
              icon: const Icon(Icons.radar),
              label: Text(_scanning ? 'Scanne…' : 'Unprovisionierte Geräte suchen'),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: _devices.isEmpty
                  ? const Center(
                      child: Text('Keine unprovisionierten Geräte gefunden'),
                    )
                  : ListView.builder(
                      itemCount: _devices.length,
                      itemBuilder: (context, index) {
                        final device = _devices[index];
                        final busy = _activeProvisionId == device.uuid.toString();
                        return ListTile(
                          leading: const Icon(Icons.device_unknown),
                          title: Text(
                            device.uuid.toString(),
                            style: const TextStyle(fontFamily: 'monospace', fontSize: 13),
                          ),
                          trailing: busy
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : FilledButton(
                                  onPressed: () => _provision(device),
                                  child: const Text('Provisionieren'),
                                ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Schließen'),
        ),
      ],
    );
  }
}
