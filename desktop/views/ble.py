"""📡 BLE Professional Suite – Desktop-View (CustomTkinter).

Scan & Klassifizierung, GATT-Explorer, Mesh, Tests, Simulator, Profile und
Audit-Log – spiegelgleich zur Web-App (src/components/ble/). Alle Aktionen
laufen über desktop/utils/ble_suite.py (gemeinsam mit dem Agenten).
"""
from __future__ import annotations

import customtkinter as ctk

from ..utils.ble_suite import BleSuite, DEVICE_CLASS_LABELS
from ..utils.ble_suite import GattCharacteristic, GattService

CLASS_COLORS = {
    "ntag": "#a78bfa", "token": "#22d3ee", "mesh": "#fbbf24", "peripheral": "#cbd5e1",
}


class BleSuiteView(ctk.CTkFrame):
    """BLE Professional Suite – Haupt-View in der Desktop-Konsole."""

    def __init__(self, master, suite: BleSuite, role: str) -> None:
        super().__init__(master, fg_color="transparent")
        self.suite = suite
        self.suite.set_role(role)
        self._selected_device_id: str | None = None

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)

        # Kopfzeile
        header = ctk.CTkFrame(self, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 4))
        header.grid_columnconfigure(2, weight=1)

        ctk.CTkLabel(header, text="📡 BLE Professional Suite",
                     font=ctk.CTkFont(size=18, weight="bold")).grid(row=0, column=0, sticky="w", padx=4)
        self.role_label = ctk.CTkLabel(header, text=f"🛡️ Rolle: {role}",
                                       text_color="#7dd3fc", font=ctk.CTkFont(size=12))
        self.role_label.grid(row=0, column=1, padx=10)

        self.scan_btn = ctk.CTkButton(header, text="▶️ BLE-Scan starten", width=150,
                                      command=self._toggle_scan)
        self.scan_btn.grid(row=0, column=3, padx=4)
        ctk.CTkButton(header, text="🧹 Log leeren", width=100,
                      command=lambda: self.logbox.delete("1.0", "end")).grid(row=0, column=4, padx=4)

        # Geräteliste links + Tabs rechts
        self.grid_columnconfigure(1, weight=3)
        left = ctk.CTkFrame(self, width=330, fg_color="#0b1220")
        left.grid(row=1, column=0, sticky="nsw", padx=10, pady=6)
        left.grid_propagate(False)

        ctk.CTkLabel(left, text="Erkannte BLE-Geräte (auto-klassifiziert)",
                     text_color="#94a3b8", font=ctk.CTkFont(size=12)).pack(anchor="w", padx=8, pady=(6, 2))
        self.device_list = ctk.CTkScrollableFrame(left, fg_color="transparent", width=310)
        self.device_list.pack(fill="both", expand=True, padx=6, pady=4)

        self.tabs = ctk.CTkTabview(self)
        self.tabs.grid(row=1, column=1, sticky="nsew", padx=(0, 10), pady=6)
        for name in ("GATT", "Mesh", "Tests", "Simulator", "Profile", "Audit"):
            self.tabs.add(name)

        self._build_gatt_tab(self.tabs.tab("GATT"))
        self._build_mesh_tab(self.tabs.tab("Mesh"))
        self._build_tests_tab(self.tabs.tab("Tests"))
        self._build_simulator_tab(self.tabs.tab("Simulator"))
        self._build_profiles_tab(self.tabs.tab("Profile"))
        self._build_audit_tab(self.tabs.tab("Audit"))

        # Log
        ctk.CTkLabel(self, text="🔍 BLE-Konsole (Scan-Protokoll, Debug, GATT, Agent-Fortschritt)",
                     text_color="#94a3b8", font=ctk.CTkFont(size=11)).grid(row=2, column=0, columnspan=2, sticky="w", padx=12)
        self.logbox = ctk.CTkTextbox(self, height=150, font=ctk.CTkFont(family="Consolas", size=11))
        self.logbox.grid(row=3, column=0, columnspan=2, sticky="ew", padx=12, pady=(0, 10))
        self.logbox.configure(state="disabled")

        self._refresh_devices()
        self.after(2000, self._periodic)

    # ------------------------------------------------------------------
    def _log(self, text: str) -> None:
        self.logbox.configure(state="normal")
        self.logbox.insert("end", f"[{self.suite.__class__.__name__}] {text}\n")
        self.logbox.see("end")
        self.logbox.configure(state="disabled")

    def _toggle_scan(self) -> None:
        if self.suite.scan_running:
            msg = self.suite.stop_scan()
            self.scan_btn.configure(text="▶️ BLE-Scan starten")
        else:
            msg = self.suite.start_scan()
            self.scan_btn.configure(text="⏹️ Scan stoppen")
        self._log(msg)
        self._refresh_devices()

    def _refresh_devices(self) -> None:
        for widget in self.device_list.winfo_children():
            widget.destroy()
        for d in self.suite.devices:
            color = CLASS_COLORS.get(d["device_class"], "#cbd5e1")
            state = "🟢" if d["connected"] else ("🔵" if d["bound"] else "⚪")
            row = ctk.CTkFrame(self.device_list, fg_color="transparent")
            row.pack(fill="x", padx=2, pady=1)
            label = (f"{state} {d['name']}  ·  {DEVICE_CLASS_LABELS[d['device_class']]}  ·  "
                     f"RSSI {d['rssi']} dBm  ·  {d['address']}")
            btn = ctk.CTkButton(row, text=label, anchor="w", height=30, fg_color="transparent",
                                hover_color="#1e293b", text_color=color,
                                command=lambda did=d["id"]: self._select_device(did))
            btn.pack(fill="x")

    def _select_device(self, device_id: str) -> None:
        self._selected_device_id = device_id
        device = next((d for d in self.suite.devices if d["id"] == device_id), None)
        if not device:
            return
        self._log(f"Gerät gewählt: {device['name']}")
        self._fill_gatt(device)
        self._gatt_load()  # GATT-Struktur sofort aktiv anzeigen

    # ------------------------------------------------------------------
    def _build_gatt_tab(self, tab) -> None:
        tab.grid_columnconfigure(0, weight=1)
        tab.grid_rowconfigure(1, weight=1)
        bar = ctk.CTkFrame(tab, fg_color="transparent")
        bar.grid(row=0, column=0, sticky="ew", padx=4, pady=4)
        self.gatt_connect_btn = ctk.CTkButton(bar, text="🔗 Verbinden", width=120,
                                              command=self._gatt_connect)
        self.gatt_connect_btn.pack(side="left", padx=4)
        ctk.CTkButton(bar, text="🔍 Dienste laden", width=120,
                      command=self._gatt_load).pack(side="left", padx=4)
        self.gatt_tree = ctk.CTkTextbox(tab, font=ctk.CTkFont(family="Consolas", size=12))
        self.gatt_tree.grid(row=1, column=0, sticky="nsew", padx=4, pady=4)
        self.gatt_tree.insert("1.0", "GATT-Explorer: links ein Gerät wählen, dann „Dienste laden“.\n"
                                    "Read/Write/Notify direkt im Agent-Chat möglich („lies batterie level …“).")
        self.gatt_tree.configure(state="disabled")

    def _gatt_connect(self) -> None:
        if not self._selected_device_id:
            self._log("Bitte zuerst ein Gerät wählen.")
            return
        self._log(self.suite.connect(self._selected_device_id))
        self._refresh_devices()

    def _gatt_load(self) -> None:
        if not self._selected_device_id:
            self._log("Bitte zuerst ein Gerät wählen.")
            return
        # Host-Backend: echte GATT-Services vom Host laden (ATT-Discovery)
        services = None
        device = next((d for d in self.suite.devices
                       if d["id"] == self._selected_device_id), None)
        if self.suite.backend == "host" and device and device.get("real"):
            try:
                from ..utils.api_client import APIClient
                data = APIClient._safe(
                    APIClient._request, "GET",
                    f"/api/ble/devices/{self._selected_device_id}/gatt")
                if data and data.get("services"):
                    services = []
                    for s in data["services"]:
                        svc = GattService(
                            s.get("uuid", "?"),
                            s.get("name", s.get("uuid", "?")[:4].upper()),
                            [GattCharacteristic(
                                c.get("uuid", "?"),
                                c.get("name", c.get("uuid", "?")[:4].upper()),
                                c.get("properties", []),
                            ) for c in s.get("characteristics", [])],
                        )
                        services.append(svc)
            except Exception as exc:  # noqa: BLE001
                self._log(f"Host-GATT fehlgeschlagen: {exc}")
        if services is None:
            services = self.suite.gatt_services(self._selected_device_id)
        lines = ["📚 GATT-Services:" + (" (Host, echte Discovery)" if services is not None else "")]
        for svc in services:
            lines.append(f"- {svc.name} ({svc.uuid})")
            for ch in svc.characteristics:
                props = "/".join(ch.properties)
                lines.append(f"    · {ch.name} ({ch.uuid}) – {props} – 0x{ch.value_hex}")
        text = "\n".join(lines)
        self.gatt_tree.configure(state="normal")
        self.gatt_tree.delete("1.0", "end")
        self.gatt_tree.insert("1.0", text)
        self.gatt_tree.configure(state="disabled")

    def _fill_gatt(self, device: dict) -> None:
        self._log(f"GATT-Profil für {device['name']} verfügbar (Klasse {DEVICE_CLASS_LABELS[device['device_class']]}).")

    # ------------------------------------------------------------------
    def _build_mesh_tab(self, tab) -> None:
        tab.grid_columnconfigure(0, weight=1)
        tab.grid_rowconfigure(2, weight=1)
        row = ctk.CTkFrame(tab, fg_color="transparent")
        row.grid(row=0, column=0, sticky="ew", padx=4, pady=4)
        self.mesh_name = ctk.CTkEntry(row, placeholder_text="Netzwerkname…", width=220)
        self.mesh_name.pack(side="left", padx=4)
        ctk.CTkButton(row, text="🌐 Netzwerk erstellen", command=self._mesh_create).pack(side="left", padx=4)
        ctk.CTkButton(row, text="🔑 Roh-Knoten provisionieren", command=self._mesh_provision).pack(side="left", padx=4)
        self.mesh_tree = ctk.CTkTextbox(tab, font=ctk.CTkFont(family="Consolas", size=12))
        self.mesh_tree.grid(row=1, column=0, sticky="nsew", padx=4, pady=4)
        self.mesh_tree.configure(state="disabled")
        self._refresh_mesh()

    def _mesh_create(self) -> None:
        name = self.mesh_name.get().strip() or "Büro-Netz"
        self._log(self.suite.create_mesh(name))
        self._refresh_mesh()

    def _mesh_provision(self) -> None:
        network = self.suite.mesh_networks[-1]
        candidates = [d for d in self.suite.devices
                      if d["device_class"] == "mesh" and not d["provisioned"]]
        if not candidates:
            self._log("Keine unprovisionierten Mesh-Knoten im Scan-Bereich.")
            return
        for d in candidates:
            self._log(self.suite.provision_node(network.id, d["id"]))
        self._refresh_mesh()

    def _refresh_mesh(self) -> None:
        lines = ["🌐 Mesh-Netzwerke & Live-Status:"]
        for n in self.suite.mesh_networks:
            lines.append(f"- {n.name} (NetKey {n.net_key[:8]}…, TTL {n.ttl})")
            for node in n.nodes:
                icon = "🟢" if node.online else "🔴"
                lines.append(f"    · {icon} {node.name} – {node.unicast} – {node.role} – "
                             f"Pub {node.pub}/Sub {node.sub} – RSSI {node.rssi} – Batt {node.battery}%")
        self.mesh_tree.configure(state="normal")
        self.mesh_tree.delete("1.0", "end")
        self.mesh_tree.insert("1.0", "\n".join(lines))
        self.mesh_tree.configure(state="disabled")

    # ------------------------------------------------------------------
    def _build_tests_tab(self, tab) -> None:
        tab.grid_columnconfigure(0, weight=1)
        tab.grid_rowconfigure(1, weight=1)
        row = ctk.CTkFrame(tab, fg_color="transparent")
        row.grid(row=0, column=0, sticky="ew", padx=4, pady=4)
        for suite in self.suite.test_suites:
            ctk.CTkButton(
                row, text=f"🧪 {suite['name'][:28]}",
                command=lambda sid=suite["id"]: self._run_suite(sid),
            ).pack(side="left", padx=3)
        ctk.CTkButton(row, text="📈 Durchsatz", command=self._throughput).pack(side="left", padx=3)
        ctk.CTkButton(row, text="⏱️ Latenz", command=self._latency).pack(side="left", padx=3)
        self.test_tree = ctk.CTkTextbox(tab, font=ctk.CTkFont(family="Consolas", size=12))
        self.test_tree.grid(row=1, column=0, sticky="nsew", padx=4, pady=4)
        self.test_tree.configure(state="disabled")

    def _run_suite(self, suite_id: str) -> None:
        result = self.suite.run_suite(suite_id)
        self._log(result)
        self.test_tree.configure(state="normal")
        self.test_tree.delete("1.0", "end")
        self.test_tree.insert("1.0", result)
        self.test_tree.configure(state="disabled")

    def _throughput(self) -> None:
        self._log(self.suite.run_throughput_test(247))

    def _latency(self) -> None:
        self._log(self.suite.run_latency_test(20))

    # ------------------------------------------------------------------
    def _build_simulator_tab(self, tab) -> None:
        tab.grid_columnconfigure(0, weight=1)
        row = ctk.CTkFrame(tab, fg_color="transparent")
        row.grid(row=0, column=0, sticky="ew", padx=4, pady=4)
        self.sim_name = ctk.CTkEntry(row, placeholder_text="Name…", width=200)
        self.sim_name.pack(side="left", padx=4)
        self.sim_cls = ctk.CTkOptionMenu(row, values=list(DEVICE_CLASS_LABELS.values()))
        self.sim_cls.set("BLE-Token")
        self.sim_cls.pack(side="left", padx=4)
        ctk.CTkButton(row, text="➕ Simuliertes Gerät", command=self._spawn_sim).pack(side="left", padx=4)
        ctk.CTkButton(row, text="🗑️ Alle entfernen", command=self._clear_sims).pack(side="left", padx=4)
        self.sim_tree = ctk.CTkTextbox(tab, font=ctk.CTkFont(family="Consolas", size=12), height=140)
        self.sim_tree.grid(row=1, column=0, sticky="ew", padx=4, pady=4)
        self.sim_tree.configure(state="disabled")

    def _spawn_sim(self) -> None:
        label = self.sim_cls.get()
        cls = next(k for k, v in DEVICE_CLASS_LABELS.items() if v == label)
        name = self.sim_name.get().strip() or f"Sim-{cls}"
        self._log(self.suite.spawn_sim_device(name, cls))
        self._refresh_sims()

    def _clear_sims(self) -> None:
        self.suite.sim_devices.clear()
        self._refresh_sims()

    def _refresh_sims(self) -> None:
        self.sim_tree.configure(state="normal")
        self.sim_tree.delete("1.0", "end")
        lines = [f"  - {d['name']} ({DEVICE_CLASS_LABELS[d['device_class']]}, "
                 f"Adv {d['adv_interval_ms']} ms, RSSI {d['rssi']} dBm)"
                 for d in self.suite.sim_devices]
        self.sim_tree.insert("1.0", "\n".join(lines) or "Keine simulierten Geräte.")
        self.sim_tree.configure(state="disabled")

    # ------------------------------------------------------------------
    def _build_profiles_tab(self, tab) -> None:
        tab.grid_columnconfigure(0, weight=1)
        tab.grid_rowconfigure(1, weight=1)
        row = ctk.CTkFrame(tab, fg_color="transparent")
        row.grid(row=0, column=0, sticky="ew", padx=4, pady=4)
        ctk.CTkButton(row, text="💾 Profil speichern (NTag-Standard)", command=self._save_profile).pack(side="left", padx=4)
        self.profile_tree = ctk.CTkTextbox(tab, font=ctk.CTkFont(family="Consolas", size=12))
        self.profile_tree.grid(row=1, column=0, sticky="nsew", padx=4, pady=4)
        self.profile_tree.configure(state="disabled")
        self._refresh_profiles()

    def _save_profile(self) -> None:
        steps = [
            {"type": "gatt_read", "target": "Battery Level", "detail": "Batteriestand lesen"},
            {"type": "gatt_write", "target": "Battery Monitoring (Zustand)", "detail": "Überwachung aktivieren", "value": "BEEF"},
            {"type": "verify", "target": "NTag-Tracker", "detail": "Funktionsprüfung"},
        ]
        self._log(self.suite.save_profile("NTag Batterieüberwachung (Desktop)", "ntag", steps))
        self._refresh_profiles()

    def _refresh_profiles(self) -> None:
        self.profile_tree.configure(state="normal")
        self.profile_tree.delete("1.0", "end")
        lines = [f"- {p.name} ({DEVICE_CLASS_LABELS[p.device_class]}, {len(p.steps)} Schritte)"
                 for p in self.suite.profiles]
        self.profile_tree.insert("1.0", "\n".join(lines) or "Keine Profile.")
        self.profile_tree.configure(state="disabled")

    # ------------------------------------------------------------------
    def _build_audit_tab(self, tab) -> None:
        tab.grid_columnconfigure(0, weight=1)
        tab.grid_rowconfigure(1, weight=1)
        row = ctk.CTkFrame(tab, fg_color="transparent")
        row.grid(row=0, column=0, sticky="ew", padx=4, pady=4)
        ctk.CTkButton(row, text="📤 Exportieren (JSON)", command=self._export_audit).pack(side="left", padx=4)
        self.audit_tree = ctk.CTkTextbox(tab, font=ctk.CTkFont(family="Consolas", size=11))
        self.audit_tree.grid(row=1, column=0, sticky="nsew", padx=4, pady=4)
        self.audit_tree.configure(state="disabled")

    def _export_audit(self) -> None:
        import os
        path = os.path.join(os.path.expanduser("~"), "ble-audit.json")
        self.suite.export_audit(path)
        self._log(f"Audit-Log exportiert nach {path}")

    def _refresh_audit(self) -> None:
        self.audit_tree.configure(state="normal")
        self.audit_tree.delete("1.0", "end")
        self.audit_tree.insert("1.0", self.suite.audit_text(30))
        self.audit_tree.configure(state="disabled")

    # ------------------------------------------------------------------
    def _periodic(self) -> None:
        try:
            if not self.winfo_exists():
                return
            if self.suite.scan_running:
                self._refresh_devices()
            if self.suite.sniffer_active and self.suite.sniffer_packets:
                self._log(f"📡 {self.suite.sniffer_packets[-1]['dir'].upper()} "
                          f"{self.suite.sniffer_packets[-1]['addr']} "
                          f"{self.suite.sniffer_packets[-1]['adv']}")
            self._refresh_audit()
            self.after(2000, self._periodic)
        except Exception:
            pass
