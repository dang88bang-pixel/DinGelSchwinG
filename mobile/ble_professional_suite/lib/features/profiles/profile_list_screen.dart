// lib/features/profiles/profile_list_screen.dart
// Profil-Cache: Liste aller Profile + Ausführung an einem Gerät.
import 'package:flutter/material.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/app_router.dart';
import '../../core/ble/ble_service.dart';
import '../../core/security/webauthn_service.dart';
import '../../providers/profile_provider.dart';
import '../../ui/widgets/custom_app_bar.dart';
import '../../ui/widgets/error_widget.dart';
import '../../ui/widgets/loading_indicator.dart';
import 'profile_card.dart';
import 'profile_controller.dart';
import 'profile_executor.dart';

class ProfileListScreen extends ConsumerStatefulWidget {
  const ProfileListScreen({super.key});

  @override
  ConsumerState<ProfileListScreen> createState() => _ProfileListScreenState();
}

class _ProfileListScreenState extends ConsumerState<ProfileListScreen> {
  final ProfileExecutor _executor = ProfileExecutor();
  BluetoothDevice? _targetDevice;

  void _syncProgress() {
    ref.read(profileExecutionProgressProvider.notifier).state =
        _executor.progress.value;
  }

  @override
  void dispose() {
    _executor.progress.removeListener(_syncProgress);
    _executor.dispose();
    super.dispose();
  }

  Future<void> _apply(BleProfile profile) async {
    // Aktives Profil + Fortschritt über Provider exponiert (aktiv verdrahtet).
    ref.read(activeProfileProvider.notifier).state = profile;
    ref.read(profileExecutionProgressProvider.notifier).state = 0;
    _executor.progress.addListener(_syncProgress);
    // Zielgerät wählen (verbundene Geräte).
    final connected = BLEService.instance.connectedDevices;
    if (connected.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Kein verbundenes Gerät – zuerst verbinden')),
      );
      return;
    }
    final device = await showModalBottomSheet<BluetoothDevice>(
      context: context,
      builder: (_) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final d in connected)
              ListTile(
                leading: const Icon(Icons.bluetooth),
                title: Text(d.platformName.isEmpty ? d.remoteId.str : d.platformName),
                onTap: () => Navigator.pop(context, d),
              ),
          ],
        ),
      ),
    );
    if (device == null || !mounted) return;

    _targetDevice = device;
    // Kritische Profile: WebAuthn-Äquivalent (biometrische Bestätigung,
    // Fallback-Dialog) – aktiv über WebAuthnService.
    if (profile.steps.any((s) => s.critical)) {
      final confirmed = await WebAuthnService.instance.confirm(
        'Profil "${profile.name}" auf ${device.platformName} anwenden',
        onFallbackRequired: () async {
          if (!mounted) return false;
          return (await showDialog<bool>(
                context: context,
                builder: (dialogContext) => AlertDialog(
                  title: const Text('Kritische Aktion'),
                  content: Text('Das Profil "${profile.name}" überschreibt die '
                      'Gerätekonfiguration.\n'
                      'WebAuthn/biometrische Bestätigung nicht verfügbar – '
                      'Fortfahren?'),
                  actions: [
                    TextButton(
                      onPressed: () => Navigator.pop(dialogContext, false),
                      child: const Text('Abbrechen'),
                    ),
                    FilledButton(
                      onPressed: () => Navigator.pop(dialogContext, true),
                      child: const Text('Bestätigen'),
                    ),
                  ],
                ),
              )) ??
              false;
        },
      );
      if (!confirmed) return;
    }

    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _ExecutionDialog(executor: _executor),
    );
    await _executor.execute(profile, device);
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final profiles = ref.watch(profilesProvider);

    return Scaffold(
      appBar: CustomAppBar(
        title: 'Profil-Cache',
        showBackButton: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'Neues Profil',
            onPressed: () async {
              await Navigator.pushNamed(context, AppRouter.profileEditor);
              ref.invalidate(profilesProvider);
            },
          ),
        ],
      ),
      body: switch (profiles) {
        AsyncData(:final value) when value.isEmpty => const Center(
            child: Text('Keine Profile – lege ein neues Profil an.'),
          ),
        AsyncData(:final value) => ListView.builder(
            itemCount: value.length,
            itemBuilder: (context, index) {
              final profile = value[index];
              return ProfileCard(
                profile: profile,
                onEdit: () async {
                  await Navigator.pushNamed(context, AppRouter.profileEditor,
                      arguments: profile);
                  ref.invalidate(profilesProvider);
                },
                onApply: () => _apply(profile),
                onDelete: () async {
                  await ref
                      .read(profileControllerProvider)
                      .delete(profile.id);
                  ref.invalidate(profilesProvider);
                },
              );
            },
          ),
        AsyncError(:final error) => AppErrorWidget(message: 'Fehler: $error'),
        _ => const LoadingIndicator(label: 'Profile werden geladen…'),
      },
    );
  }
}

class _ExecutionDialog extends StatelessWidget {
  final ProfileExecutor executor;

  const _ExecutionDialog({required this.executor});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Profil-Ausführung'),
      content: SizedBox(
        width: 320,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ValueListenableBuilder<double>(
              valueListenable: executor.progress,
              builder: (context, value, _) => LinearProgressIndicator(value: value),
            ),
            const SizedBox(height: 12),
            ValueListenableBuilder<String>(
              valueListenable: executor.status,
              builder: (context, value, _) => Text(value, textAlign: TextAlign.center),
            ),
          ],
        ),
      ),
    );
  }
}
