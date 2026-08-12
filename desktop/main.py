#!/usr/bin/env python3
"""DinGelSchwinG v3.0 – Agent Console (CustomTkinter).

Start:  python main.py
Login → Hauptfenster mit Chat, 6 Aktionsbuttons, Skripte-Galerie,
Status-Panel (Live), Einstellungen (Systeminstruktionen + Modell).

Backend (optional): Flask-API + WebSocket auf localhost:5000.
Ohne Backend läuft alles offline mit Mock-Daten.
"""
from __future__ import annotations

import sys
import threading

import customtkinter as ctk

from utils.agent import Agent
from utils.config import load_config
from utils.status_manager import StatusManager
from views.ble import BleSuiteView
from views.chat import ChatView
from views.dashboard import DashboardView
from views.scripts import ScriptsView
from views.settings import SettingsView
from views.status_panel import StatusPanel

APP_TITLE = "DinGelSchwinG v3.0 – Agent Console"
ROLES = ["admin", "service", "user"]


# --------------------------------------------------------------------------
# Login
# --------------------------------------------------------------------------
class LoginDialog(ctk.CTkToplevel):
    """Einfacher Login: Name + Rolle (RBAC für Aktionen wie Löschen)."""

    def __init__(self, master, on_login) -> None:
        super().__init__(master)
        self.on_login = on_login
        self.title("Login – DinGelSchwinG")
        self.geometry("360x320")
        self.resizable(False, False)
        self.transient(master)

        ctk.CTkLabel(self, text="🔐 DinGelSchwinG", font=ctk.CTkFont(size=22, weight="bold")).pack(pady=(24, 2))
        ctk.CTkLabel(self, text="Agent Console – Anmeldung", text_color="#94a3b8").pack(pady=(0, 16))

        self.name_entry = ctk.CTkEntry(self, placeholder_text="Benutzername")
        self.name_entry.pack(fill="x", padx=30, pady=6)

        self.role_menu = ctk.CTkOptionMenu(self, values=ROLES)
        self.role_menu.set("admin")
        self.role_menu.pack(fill="x", padx=30, pady=6)

        self.error_label = ctk.CTkLabel(self, text="", text_color="#f87171")
        self.error_label.pack(pady=4)

        ctk.CTkButton(self, text="Login", command=self._login).pack(fill="x", padx=30, pady=10)
        self.bind("<Return>", lambda _e: self._login())
        self.name_entry.focus_set()

    def _login(self) -> None:
        name = self.name_entry.get().strip() or "admin"
        role = self.role_menu.get()
        # Passwort-Regel nur als Demo: admin-Rolle erfordert 'admin'
        if role == "admin" and name != "admin":
            self.error_label.configure(text="Für admin bitte Benutzername 'admin' verwenden.")
            return
        self.on_login(name, role)
        self.destroy()


# --------------------------------------------------------------------------
# Hauptfenster
# --------------------------------------------------------------------------
class MainWindow(ctk.CTk):
    """Hauptfenster: Sidebar-Navigation + Content + Status-Bar."""

    def __init__(self, user_name: str, role: str) -> None:
        super().__init__()
        self.user_name = user_name
        self.role = role

        self.title(APP_TITLE)
        self.geometry("1220x780")
        self.minsize(940, 600)

        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.config_data = load_config()
        self.config_data["role"] = role
        self.status = StatusManager(
            ws_url=self.config_data.get("ws_url", "ws://localhost:5000/ws/status"),
            poll_interval=float(self.config_data.get("poll_interval", 10.0)),
        )
        self.agent = Agent(role=role, config=self.config_data, status=self.status)

        self._build_layout()
        self._wire_events()

        self.status.start()
        self.status.register_observer(self._on_status_update)
        self.after(500, self._on_status_update)

    # ------------------------------------------------------------------
    def _build_layout(self) -> None:
        self.grid_columnconfigure(1, weight=1)
        self.grid_rowconfigure(1, weight=1)

        # Kopfzeile
        header = ctk.CTkFrame(self, fg_color="#0b1220", corner_radius=0, height=54)
        header.grid(row=0, column=0, columnspan=2, sticky="ew")
        header.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(header, text="⚡ DinGelSchwinG v3.0 – Agent Console",
                     font=ctk.CTkFont(size=16, weight="bold")).grid(row=0, column=0, sticky="w", padx=14)
        ctk.CTkLabel(header, text=f"👤 {self.user_name} ({self.role})",
                     font=ctk.CTkFont(size=13)).grid(row=0, column=1, padx=6)
        ctk.CTkButton(header, text="⚙️", width=38, command=self._show_settings).grid(row=0, column=2, padx=(0, 10))

        # Sidebar
        sidebar = ctk.CTkFrame(self, width=190, corner_radius=0, fg_color="#0b1220")
        sidebar.grid(row=1, column=0, sticky="nsw")
        sidebar.grid_propagate(False)
        self.nav_buttons: dict[str, ctk.CTkButton] = {}
        for i, (label, key) in enumerate([
            ("📊 Dashboard", "dashboard"),
            ("💬 Chat", "chat"),
            ("📡 BLE Suite", "ble"),
            ("🛠️ Skripte", "scripts"),
            ("⚙️ Einstellungen", "settings"),
        ]):
            btn = ctk.CTkButton(sidebar, text=label, anchor="w", height=40, corner_radius=10,
                                fg_color="transparent", hover_color="#1e293b",
                                command=lambda k=key: self._navigate(k))
            btn.grid(row=i, column=0, sticky="ew", padx=8, pady=3)
            self.nav_buttons[key] = btn
        ctk.CTkButton(sidebar, text="📡 Status-Panel öffnen", height=40, corner_radius=10,
                      command=self._open_status_panel).grid(row=5, column=0, sticky="ew", padx=8, pady=(14, 3))
        ctk.CTkLabel(sidebar, text=f"v3.0 · {self.role}", text_color="#475569",
                     font=ctk.CTkFont(size=11)).grid(row=6, column=0, pady=8)

        # Content
        self.content = ctk.CTkFrame(self, fg_color="#020617", corner_radius=0)
        self.content.grid(row=1, column=1, sticky="nsew")
        self.content.grid_columnconfigure(0, weight=1)
        self.content.grid_rowconfigure(0, weight=1)

        self.views: dict[str, ctk.CTkFrame] = {}
        self.views["dashboard"] = DashboardView(self.content, self.status)
        self.views["ble"] = BleSuiteView(self.content, self.agent.ble_suite, role=self.role)
        self.chat_view = ChatView(self.content, self.agent,
                                  on_open_settings=self._show_settings,
                                  on_open_status=self._open_status_panel)
        self.views["chat"] = self.chat_view
        self.scripts_view = ScriptsView(self.content, self.agent.executor, role=self.role,
                                        on_output=self._script_output)
        self.views["scripts"] = self.scripts_view
        self.views["settings"] = SettingsView(self.content, self.agent, on_saved=self._on_settings_saved)

        # Status-Bar (unten, über beide Spalten)
        status_bar = ctk.CTkFrame(self, fg_color="#0b1220", corner_radius=0, height=34)
        status_bar.grid(row=2, column=0, columnspan=2, sticky="ew")
        self.status_bar_label = ctk.CTkLabel(status_bar, text="…", anchor="w",
                                             font=ctk.CTkFont(size=12), text_color="#7dd3fc")
        self.status_bar_label.pack(side="left", padx=12, pady=4)

        self._navigate("chat")

    def _wire_events(self) -> None:
        self.protocol("WM_DELETE_WINDOW", self._on_close)

    # ------------------------------------------------------------------
    def _navigate(self, key: str) -> None:
        for k, btn in self.nav_buttons.items():
            btn.configure(fg_color="#1e293b" if k == key else "transparent")
        for k, view in self.views.items():
            view.grid_forget() if k != key else view.grid(row=0, column=0, sticky="nsew")

    def _show_settings(self) -> None:
        self._navigate("settings")

    def _open_status_panel(self) -> None:
        StatusPanel(self, self.status)

    def _script_output(self, text: str) -> None:
        """Skript-Output im Chat anzeigen (und zur Chat-View springen)."""
        self.chat_view.add_message("system", text)

    def _on_settings_saved(self) -> None:
        self.chat_view.refresh_buttons()
        self.chat_view.model_label.configure(text=f"🧠 {self.agent.model_status()}")

    def _on_status_update(self) -> None:
        def ui() -> None:
            try:
                self.status_bar_label.configure(text=self.status.summary())
                self.chat_view.update_status_bar(self.status.summary())
            except Exception:
                pass
        self.after(0, ui)

    def _on_close(self) -> None:
        try:
            self.status.stop()
        except Exception:
            pass
        self.destroy()
        sys.exit(0)


# --------------------------------------------------------------------------
def main() -> None:
    root = ctk.CTk()
    root.withdraw()

    def on_login(name: str, role: str) -> None:
        root.destroy()
        window = MainWindow(name, role)
        window.mainloop()

    LoginDialog(root, on_login)
    root.mainloop()


if __name__ == "__main__":
    main()
