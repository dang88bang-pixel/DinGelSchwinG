// lib/features/mesh/mesh_screen.dart
// Mesh-Netzwerk-Management: Erstellen, Provisionieren, Topologie, Details,
// Gruppen. Alle Operationen über MeshService (echte nRF-Mesh-Hardware).
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/app_router.dart';
import '../../providers/mesh_provider.dart';
import 'group_manager.dart';
import 'mesh_controller.dart';
import 'provision_wizard.dart';
import 'topology_graph.dart';

class MeshScreen extends ConsumerStatefulWidget {
  const MeshScreen({super.key});

  @override
  ConsumerState<MeshScreen> createState() => _MeshScreenState();
}

class _MeshScreenState extends ConsumerState<MeshScreen> {
  String _networkName = '';
  String _networkPassphrase = '';

  @override
  Widget build(BuildContext context) {
    final network = ref.watch(meshServiceProvider).activeNetwork;

    return Scaffold(
      appBar: AppBar(
        title: Text(network?.name ?? 'BLE Mesh'),
        actions: [
          if (network == null)
            IconButton(
              icon: const Icon(Icons.add_circle),
              tooltip: 'Netzwerk erstellen',
              onPressed: () => _createNetwork(context),
            )
          else ...[
            IconButton(
              icon: const Icon(Icons.add_ble),
              tooltip: 'Knoten provisionieren',
              onPressed: () => showDialog<void>(
                context: context,
                builder: (_) => const ProvisionWizard(),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.group),
              tooltip: 'Gruppen verwalten',
              onPressed: () => showDialog<void>(
                context: context,
                builder: (_) => const GroupManager(),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'Topologie aktualisieren',
              onPressed: () => ref.read(meshControllerProvider).refreshTopology(),
            ),
          ],
        ],
      ),
      body: network == null
          ? const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.network_off, size: 64),
                  SizedBox(height: 16),
                  Text('Kein aktives Mesh-Netzwerk'),
                  Text('Erstelle ein neues Netzwerk oder lade ein bestehendes'),
                ],
              ),
            )
          : Column(
              children: [
                // Mesh-Info
                Container(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Netzwerk: ${network.name}',
                                style: Theme.of(context).textTheme.titleMedium),
                            Text('Knoten: ${network.nodes.length}'),
                            Text('UUID: ${network.id.toString().substring(0, 8)}…'),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                // Topologie-Graph
                Expanded(
                  flex: 2,
                  child: TopologyGraph(
                    nodes: network.nodes,
                    onNodeTap: (node) {
                      Navigator.pushNamed(context, AppRouter.meshNode,
                          arguments: node);
                    },
                  ),
                ),
              ],
            ),
    );
  }

  void _createNetwork(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Mesh-Netzwerk erstellen'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              decoration: const InputDecoration(
                labelText: 'Name',
                hintText: 'Mein Mesh-Netzwerk',
              ),
              onChanged: (value) => _networkName = value,
            ),
            const SizedBox(height: 16),
            TextField(
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Passphrase',
                hintText: 'Sicherheitsphrase',
              ),
              onChanged: (value) => _networkPassphrase = value,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Abbrechen'),
          ),
          ElevatedButton(
            onPressed: () async {
              if (_networkName.isNotEmpty && _networkPassphrase.isNotEmpty) {
                try {
                  await ref
                      .read(meshControllerProvider)
                      .createNetwork(_networkName, _networkPassphrase);
                } catch (e) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Erstellen fehlgeschlagen: $e')),
                    );
                  }
                }
                Navigator.pop(dialogContext);
              }
            },
            child: const Text('Erstellen'),
          ),
        ],
      ),
    );
  }
}
