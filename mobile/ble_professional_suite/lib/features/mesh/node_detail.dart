// lib/features/mesh/node_detail.dart
// Detailseite eines Mesh-Knotens: Modelle, Pub/Sub, TTL, Aktionen.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nrf_mesh_flutter/nrf_mesh_flutter.dart';
import 'mesh_controller.dart';

class NodeDetailScreen extends ConsumerStatefulWidget {
  final dynamic node;

  const NodeDetailScreen({super.key, this.node});

  @override
  ConsumerState<NodeDetailScreen> createState() => _NodeDetailScreenState();
}

class _NodeDetailScreenState extends ConsumerState<NodeDetailScreen> {
  ProvisionedNode? get _node => widget.node is ProvisionedNode
      ? widget.node as ProvisionedNode
      : null;

  @override
  Widget build(BuildContext context) {
    final node = _node;
    if (node == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Knoten-Details')),
        body: const Center(child: Text('Kein Knoten gewählt')),
      );
    }

    return Scaffold(
      appBar: AppBar(title: Text(node.name ?? 'Mesh-Knoten')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _InfoRow('UUID', node.uuid.toString()),
          _InfoRow('Unicast', '0x${node.unicastAddress.toRadixString(16)}'),
          _InfoRow('Elements', '${node.elements.length}'),
          const SizedBox(height: 16),
          Text('Modelle', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          for (final element in node.elements)
            for (final model in element.models)
              Card(
                child: ListTile(
                  dense: true,
                  leading: const Icon(Icons.view_module),
                  title: Text('0x${model.modelId.value.toRadixString(16)}'),
                  subtitle: Text(
                    'Pub: ${model.publicationAddress != null ? "0x${model.publicationAddress!.toRadixString(16)}" : "–"}',
                  ),
                ),
              ),
          const SizedBox(height: 16),
          FilledButton.icon(
            icon: const Icon(Icons.send),
            label: const Text('OnOff-Test: 1 (An) senden'),
            onPressed: () async {
              try {
                await ref
                    .read(meshControllerProvider)
                    .sendOnOff(node.unicastAddress, true);
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('OnOff Set gesendet')),
                  );
                }
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Senden fehlgeschlagen: $e')),
                  );
                }
              }
            },
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;

  const _InfoRow(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          const Spacer(),
          Text(value,
              style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
