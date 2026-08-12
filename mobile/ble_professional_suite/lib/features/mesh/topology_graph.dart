// lib/features/mesh/topology_graph.dart
// Einfacher Topologie-Graph der Mesh-Knoten (Kreis-Layout + Verbindungen).
// Für komplexe Topologien kann hier CustomPainter/GraphView eingesetzt werden.
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:nrf_mesh_flutter/nrf_mesh_flutter.dart';

class TopologyGraph extends StatefulWidget {
  final List<ProvisionedNode> nodes;
  final void Function(ProvisionedNode node)? onNodeTap;

  const TopologyGraph({super.key, required this.nodes, this.onNodeTap});

  @override
  State<TopologyGraph> createState() => _TopologyGraphState();
}

class _TopologyGraphState extends State<TopologyGraph> {
  @override
  Widget build(BuildContext context) {
    final nodes = widget.nodes;
    if (nodes.isEmpty) {
      return const Center(child: Text('Noch keine Knoten im Netzwerk'));
    }

    return CustomPaint(
      painter: _TopologyPainter(nodes),
      child: Center(
        child: SizedBox(
          width: double.infinity,
          height: double.infinity,
          child: Stack(
            children: [
              for (var i = 0; i < nodes.length; i++)
                Positioned(
                  left: 20 + (math.sin(i * 2 * math.pi / nodes.length) + 1) *
                      (MediaQuery.sizeOf(context).width - 180) /
                      2,
                  top: 20 + (math.cos(i * 2 * math.pi / nodes.length) + 1) *
                      (MediaQuery.sizeOf(context).height - 160) /
                      2,
                  child: _NodeChip(
                    node: nodes[i],
                    onTap: () => widget.onNodeTap?.call(nodes[i]),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NodeChip extends StatelessWidget {
  final ProvisionedNode node;
  final VoidCallback? onTap;

  const _NodeChip({required this.node, this.onTap});

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: node.name ?? node.uuid.toString(),
      child: Material(
        color: Colors.blueGrey.shade800,
        borderRadius: BorderRadius.circular(24),
        child: InkWell(
          borderRadius: BorderRadius.circular(24),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.circle, size: 10, color: Colors.greenAccent),
                const SizedBox(width: 6),
                Text(
                  node.name ?? '0x${node.unicastAddress.toRadixString(16)}',
                  style: const TextStyle(fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _TopologyPainter extends CustomPainter {
  final List<ProvisionedNode> nodes;

  _TopologyPainter(this.nodes);

  @override
  void paint(Canvas canvas, Size size) {
    if (nodes.length < 2) return;
    final paint = Paint()
      ..color = Colors.blueGrey.withValues(alpha: 0.4)
      ..strokeWidth = 1.5;
    for (var i = 0; i < nodes.length; i++) {
      final a = _center(i, size);
      for (var j = i + 1; j < nodes.length; j++) {
        canvas.drawLine(a, _center(j, size), paint);
      }
    }
  }

  Offset _center(int index, Size size) {
    final angle = index * 2 * math.pi / nodes.length;
    return Offset(
      20 + (math.sin(angle) + 1) * (size.width - 160) / 2 + 40,
      20 + (math.cos(angle) + 1) * (size.height - 140) / 2 + 40,
    );
  }

  @override
  bool shouldRepaint(covariant _TopologyPainter oldDelegate) =>
      oldDelegate.nodes.length != nodes.length;
}
