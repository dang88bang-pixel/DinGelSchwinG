// lib/features/profiles/profile_editor.dart
// Editor für Konfigurationsprofile: Schritte hinzufügen/bearbeiten/entfernen.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/models/ble_profile.dart';
import 'profile_controller.dart';

class ProfileEditorScreen extends ConsumerStatefulWidget {
  /// Optional: zu bearbeitendes Profil; null → neues Profil.
  final dynamic profile;

  const ProfileEditorScreen({super.key, this.profile});

  @override
  ConsumerState<ProfileEditorScreen> createState() => _ProfileEditorScreenState();
}

class _ProfileEditorScreenState extends ConsumerState<ProfileEditorScreen> {
  late final TextEditingController _nameController;
  late BleDeviceClass _deviceClass;
  late final List<ConfigStep> _steps;
  final List<TextEditingController> _stepDetailControllers = [];

  BleProfile? get _existing =>
      widget.profile is BleProfile ? widget.profile as BleProfile : null;

  @override
  void initState() {
    super.initState();
    final existing = _existing;
    _nameController = TextEditingController(text: existing?.name ?? '');
    _deviceClass = existing?.deviceClass ?? BleDeviceClass.token;
    _steps = [...?existing?.steps];
    for (final step in _steps) {
      _stepDetailControllers.add(TextEditingController(text: step.detail));
    }
  }

  void _addStep(ConfigStepType type) {
    setState(() {
      _steps.add(ConfigStep(
        type: type,
        target: '',
        detail: '${type.label}-Schritt',
      ));
      _stepDetailControllers.add(TextEditingController(text: '${type.label}-Schritt'));
    });
  }

  void _removeStep(int index) {
    setState(() {
      _steps.removeAt(index);
      _stepDetailControllers.removeAt(index).dispose();
    });
  }

  Future<void> _save() async {
    final name = _nameController.text.trim();
    if (name.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Profilname fehlt')),
      );
      return;
    }
    final steps = <ConfigStep>[
      for (var i = 0; i < _steps.length; i++)
        ConfigStep(
          type: _steps[i].type,
          target: _steps[i].target,
          detail: _stepDetailControllers[i].text.trim().isEmpty
              ? _steps[i].detail
              : _stepDetailControllers[i].text.trim(),
          value: _steps[i].value,
          critical: _steps[i].critical,
        ),
    ];
    await ref.read(profileControllerProvider).create(
          name: name,
          deviceClass: _deviceClass,
          steps: steps,
        );
    if (mounted) Navigator.pop(context);
  }

  @override
  void dispose() {
    _nameController.dispose();
    for (final c in _stepDetailControllers) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_existing == null ? 'Neues Profil' : 'Profil bearbeiten'),
        actions: [
          IconButton(
            icon: const Icon(Icons.save),
            tooltip: 'Speichern',
            onPressed: _save,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          TextField(
            controller: _nameController,
            decoration: const InputDecoration(labelText: 'Profilname'),
          ),
          const SizedBox(height: 12),
          InputDecorator(
            decoration: const InputDecoration(labelText: 'Geräteklasse'),
            child: DropdownButton<BleDeviceClass>(
              value: _deviceClass,
              isDense: true,
              isExpanded: true,
              underline: const SizedBox.shrink(),
              items: BleDeviceClass.values
                  .map((c) => DropdownMenuItem(value: c, child: Text(c.label)))
                  .toList(),
              onChanged: (value) {
                if (value != null) setState(() => _deviceClass = value);
              },
            ),
          ),
          const SizedBox(height: 16),
          Text('Schritte', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          for (var i = 0; i < _steps.length; i++)
            Card(
              child: ListTile(
                leading: Icon(
                  _steps[i].critical ? Icons.warning_amber : Icons.touch_app,
                  color: _steps[i].critical ? Colors.orange : null,
                ),
                title: Text(_steps[i].type.label),
                subtitle: TextField(
                  controller: _stepDetailControllers[i],
                  decoration: const InputDecoration(border: InputBorder.none),
                ),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () => _removeStep(i),
                ),
              ),
            ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            children: [
              for (final type in [
                ConfigStepType.gattRead,
                ConfigStepType.gattWrite,
                ConfigStepType.notifyOn,
                ConfigStepType.mtu,
                ConfigStepType.verify,
              ])
                ActionChip(
                  label: Text('+ ${type.label}'),
                  onPressed: () => _addStep(type),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
