// lib/features/mesh/group_manager.dart
// Gruppenverwaltung: Gruppenadressen anlegen und Knoten zuordnen (Pub/Sub).
import 'package:flutter/material.dart';
import 'package:nrf_mesh_flutter/nrf_mesh_flutter.dart';
import '../../core/ble/mesh_service.dart';

class MeshGroup {
  final String name;
  final int address; // Gruppenadresse 0xC000–0xFEFF
  final Set<String> nodeIds;

  const MeshGroup({
    required this.name,
    required this.address,
    this.nodeIds = const {},
  });
}

class GroupManager extends StatefulWidget {
  const GroupManager({super.key});

  @override
  State<GroupManager> createState() => _GroupManagerState();
}

class _GroupManagerState extends State<GroupManager> {
  final List<MeshGroup> _groups = [
    MeshGroup(name: 'Beleuchtung EG', address: 0xC001),
    MeshGroup(name: 'Sensorik Büro 3', address: 0xC002),
  ];
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _addressController = TextEditingController();

  Future<void> _addGroup() async {
    final name = _nameController.text.trim();
    final address = int.tryParse(_addressController.text, radix: 16);
    if (name.isEmpty || address == null || address < 0xC000 || address > 0xFEFF) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Name + gültige Gruppenadresse (0xC000–0xFEFF) nötig')),
      );
      return;
    }
    setState(() {
      _groups.add(MeshGroup(name: name, address: address));
      _nameController.clear();
      _addressController.clear();
    });
  }

  /// Setzt die Gruppe als Publikationsadresse aller Knoten (Beispiel).
  Future<void> _applyToAll(MeshGroup group) async {
    final nodes = MeshService.instance.nodes;
    for (final node in nodes) {
      await MeshService.instance.setPublicationAddress(node, group.address);
    }
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Gruppe 0x${group.address.toRadixString(16)} '
            'auf ${nodes.length} Knoten angewendet')),
      );
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _addressController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Mesh-Gruppen'),
      content: SizedBox(
        width: 380,
        height: 340,
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _nameController,
                    decoration: const InputDecoration(labelText: 'Gruppenname'),
                  ),
                ),
                const SizedBox(width: 8),
                SizedBox(
                  width: 90,
                  child: TextField(
                    controller: _addressController,
                    decoration: const InputDecoration(
                      labelText: 'Adresse',
                      hintText: 'C001',
                    ),
                    style: const TextStyle(fontFamily: 'monospace'),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.add_circle),
                  tooltip: 'Gruppe anlegen',
                  onPressed: _addGroup,
                ),
              ],
            ),
            const Divider(),
            Expanded(
              child: ListView.builder(
                itemCount: _groups.length,
                itemBuilder: (context, index) {
                  final group = _groups[index];
                  return ListTile(
                    leading: const Icon(Icons.group),
                    title: Text(group.name),
                    subtitle: Text('0x${group.address.toRadixString(16)} · '
                        '${group.nodeIds.length} Knoten'),
                    trailing: IconButton(
                      icon: const Icon(Icons.send),
                      tooltip: 'Auf alle Knoten anwenden',
                      onPressed: () => _applyToAll(group),
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
