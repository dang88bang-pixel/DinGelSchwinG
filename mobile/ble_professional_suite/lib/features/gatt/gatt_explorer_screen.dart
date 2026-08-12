// lib/features/gatt/gatt_explorer_screen.dart
// GATT-Explorer: zeigt Dienste/Characteristics/Descriptors des gewählten
// Geräts (selectedDeviceProvider) und bietet Read/Write/Notify/MTU sowie
// den Export des GATT-Profils (Domänenmodell) als JSON.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/ble/ble_service.dart';
import '../../providers/ble_provider.dart';
import '../../ui/widgets/connection_status.dart';
import '../../ui/widgets/error_widget.dart';
import '../../ui/widgets/loading_indicator.dart';
import 'gatt_controller.dart';
import 'service_tree.dart';

class GattExplorerScreen extends ConsumerStatefulWidget {
  /// Optional: direkt übergebenes Gerät (Route). Ohne Angabe wird das im
  /// Scanner gewählte Gerät aus `selectedDeviceProvider` übernommen.
  final dynamic device;

  const GattExplorerScreen({super.key, this.device});

  @override
  ConsumerState<GattExplorerScreen> createState() => _GattExplorerScreenState();
}

class _GattExplorerScreenState extends ConsumerState<GattExplorerScreen> {
  GattController? _controller;

  BluetoothDevice? get _device =>
      widget.device is BluetoothDevice ? widget.device as BluetoothDevice : null;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final selected = ref.watch(selectedDeviceProvider);
    final device = _device ?? selected;
    if (device != null && (_controller == null || _controller!.device.remoteId.str != device.remoteId.str)) {
      _controller?.dispose();
      _controller = GattController(device);
      _controller!.loadServices();
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final device = _device ?? ref.watch(selectedDeviceProvider);
    final controller = _controller;

    if (device == null || controller == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('GATT-Explorer')),
        body: const Center(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.bluetooth_searching, size: 64, color: Colors.grey),
                SizedBox(height: 16),
                Text('Kein Gerät gewählt'),
                Text('Wähle im Scanner-Tab ein Gerät aus.'),
              ],
            ),
          ),
        ),
      );
    }

    final connected = BLEService.instance.isDeviceConnected(device.remoteId.str);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          device.platformName.isNotEmpty ? device.platformName : device.remoteId.str,
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Dienste neu laden',
            onPressed: controller.loadServices,
          ),
        ],
      ),
      body: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              borderRadius: const BorderRadius.only(
                bottomLeft: Radius.circular(14),
                bottomRight: Radius.circular(14),
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'MAC: ${device.remoteId.str}',
                        style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Services: ${controller.services.length} · MTU: ${controller.mtu}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                // Verbindungsstatus live über connectionStateProvider (aktiv)
                ref.watch(connectionStateProvider).when(
                      data: (entry) {
                        final connectedNow =
                            entry.$1 == device.remoteId.str &&
                                entry.$2 == ConnectionState.connected;
                        return ConnectionStatusBadge(
                          state: connectedNow
                              ? UiConnectionState.connected
                              : UiConnectionState.disconnected,
                        );
                      },
                      error: (_, __) => ConnectionStatusBadge(
                          state: UiConnectionState.disconnected),
                      loading: () => ConnectionStatusBadge(
                          state: connected
                              ? UiConnectionState.connected
                              : UiConnectionState.disconnected),
                    ),
              ],
            ),
          ),
          // MTU-Steuerung
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                const Text('MTU:'),
                const SizedBox(width: 8),
                DropdownButton<int>(
                  value: controller.mtu,
                  items: const [23, 100, 185, 247, 517]
                      .map((m) => DropdownMenuItem(value: m, child: Text('$m')))
                      .toList(),
                  onChanged: (mtu) {
                    if (mtu != null) controller.requestMtu(mtu);
                  },
                ),
              ],
            ),
          ),
          ValueListenableBuilder<String?>(
            valueListenable: controller.feedback,
            builder: (context, feedback, _) => feedback == null
                ? const SizedBox.shrink()
                : Container(
                    width: double.infinity,
                    margin: const EdgeInsets.symmetric(horizontal: 12),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.black87,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      feedback,
                      style: const TextStyle(
                        fontFamily: 'monospace',
                        fontSize: 12,
                        color: Colors.cyanAccent,
                      ),
                    ),
                  ),
          ),
          const SizedBox(height: 4),
          // GATT-Profil (Domänenmodell) als JSON exportieren/teilen
          if (controller.services.isNotEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              child: Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () async {
                    final json = controller.profileJson();
                    await Clipboard.setData(ClipboardData(text: json));
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('GATT-Profil (JSON) in die Zwischenablage '
                              'kopiert (${json.length} Zeichen)'),
                        ),
                      );
                    }
                  },
                  icon: const Icon(Icons.copy_all, size: 16),
                  label: const Text('Profil (JSON) kopieren'),
                ),
              ),
            ),
          Expanded(
            child: controller.isLoading
                ? const LoadingIndicator(label: 'Dienste werden entdeckt…')
                : controller.error != null
                    ? AppErrorWidget(
                        message: 'Fehler: ${controller.error}',
                        onRetry: controller.loadServices,
                      )
                    : controller.services.isEmpty
                        ? const Center(child: Text('Keine GATT-Dienste gefunden'))
                        : ListView(
                            children: [
                              for (final service in controller.services)
                                ServiceTree(
                                  service: service,
                                  device: device,
                                  controller: controller,
                                ),
                            ],
                          ),
          ),
        ],
      ),
    );
  }
}
