import 'dart:async';

import 'package:flutter/material.dart';

import '../state/inventory_controller.dart';
import 'history_view.dart';
import 'inventory_view.dart';
import 'scan_view.dart';
import 'search_view.dart';
import 'settings_view.dart';

/// Rahmen der App: fünf Bereiche aus dem Lastenheft (§ 6) über eine
/// Fußnavigation, darüber die Bestandszahlen.
///
/// Export/Import ist in Schritt 1 noch kein eigener Bereich — er hätte keine
/// Funktion. Der Punkt „Optionen" trägt die Einstellungen (§ 3 `AppSettings`)
/// und sagt offen, was Schritt 2 liefert.
class HomeShell extends StatefulWidget {
  const HomeShell({
    super.key,
    required this.controller,
    required this.databasePath,
  });

  final InventoryController controller;
  final String databasePath;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  static const List<String> _titles = <String>[
    'Scannen',
    'Inventar',
    'Suche',
    'Historie',
    'Optionen',
  ];

  int _index = 0;
  int _shownNotice = 0;

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onControllerChanged);
    _shownNotice = widget.controller.noticeSeq;
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onControllerChanged);
    super.dispose();
  }

  /// Jede Meldung genau einmal als SnackBar zeigen — auch denselben Text
  /// zweimal, deshalb der Zähler statt des Vergleichs der Zeichenkette.
  void _onControllerChanged() {
    final InventoryController controller = widget.controller;
    if (controller.noticeSeq == _shownNotice) {
      return;
    }
    _shownNotice = controller.noticeSeq;
    final String? text = controller.lastNotice;
    if (text == null || !mounted) {
      return;
    }
    final bool isError = controller.lastError != null;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(text),
            backgroundColor: isError ? Colors.red.shade700 : null,
            duration: Duration(seconds: isError ? 5 : 2),
          ),
        );
    });
  }

  void _onTab(int next) {
    if (next == _index) {
      return;
    }
    setState(() => _index = next);
    if (next == 1 || next == 2 || next == 3) {
      // Liste und Historie können sich durch Scans auf einem anderen Bereich
      // geändert haben — einmal neu laden kostet eine Abfrage und erspart
      // Altbestand auf dem Display.
      unawaited(widget.controller.refresh().catchError((Object error) {
        debugPrint('Aktualisierung fehlgeschlagen: $error');
      }));
    }
  }

  @override
  Widget build(BuildContext context) {
    final InventoryController controller = widget.controller;
    return Scaffold(
      appBar: AppBar(
        title: Text(_titles[_index]),
        actions: <Widget>[
          ListenableBuilder(
            listenable: controller,
            builder: (BuildContext context, Widget? child) => Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Center(
                child: Text(
                  '${controller.counts['items'] ?? 0} Artikel · '
                  '${controller.counts['units'] ?? 0} Einheiten',
                  style: Theme.of(context).textTheme.labelMedium,
                ),
              ),
            ),
          ),
        ],
      ),
      body: IndexedStack(
        index: _index,
        children: <Widget>[
          ScanView(controller: controller),
          InventoryView(controller: controller),
          SearchView(controller: controller),
          HistoryView(controller: controller),
          SettingsView(
            controller: controller,
            databasePath: widget.databasePath,
          ),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        type: BottomNavigationBarType.fixed,
        currentIndex: _index,
        onTap: _onTab,
        items: const <BottomNavigationBarItem>[
          BottomNavigationBarItem(
            icon: Icon(Icons.qr_code_scanner),
            label: 'Scan',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.inventory_2_outlined),
            label: 'Inventar',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.search),
            label: 'Suche',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.history),
            label: 'Historie',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.tune),
            label: 'Optionen',
          ),
        ],
      ),
    );
  }
}
