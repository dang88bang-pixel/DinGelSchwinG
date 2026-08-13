"""📡 Status-Panel: Geräte, Clients, Workflows, Tests, Systemlast (Echtzeit)."""
from __future__ import annotations

import customtkinter as ctk

from ..utils.status_manager import StatusManager


class StatusPanel(ctk.CTkToplevel):
    """Separates Live-Status-Fenster mit Tabs; wird per Observer aktualisiert."""

    def __init__(self, master, status: StatusManager) -> None:
        super().__init__(master)
        self.status = status
        self.title("📡 Live-Status – DinGelSchwinG")
        self.geometry("680x460")
        self.minsize(480, 320)

        self.tabview = ctk.CTkTabview(self)
        self.tabview.pack(fill="both", expand=True, padx=10, pady=(10, 4))
        for name in ("Geräte", "Clients", "Workflows", "Tests"):
            self.tabview.add(name)

        self.device_list = ctk.CTkScrollableFrame(self.tabview.tab("Geräte"), fg_color="transparent")
        self.device_list.pack(fill="both", expand=True, padx=4, pady=4)
        self.client_list = ctk.CTkScrollableFrame(self.tabview.tab("Clients"), fg_color="transparent")
        self.client_list.pack(fill="both", expand=True, padx=4, pady=4)
        self.workflow_list = ctk.CTkScrollableFrame(self.tabview.tab("Workflows"), fg_color="transparent")
        self.workflow_list.pack(fill="both", expand=True, padx=4, pady=4)
        self.test_list = ctk.CTkScrollableFrame(self.tabview.tab("Tests"), fg_color="transparent")
        self.test_list.pack(fill="both", expand=True, padx=4, pady=4)

        self.footer = ctk.CTkLabel(self, text="", anchor="w", font=ctk.CTkFont(size=12))
        self.footer.pack(fill="x", padx=12, pady=(0, 8))

        self.status.register_observer(self._safe_update)
        self.after(300, self._update_ui)

    # ------------------------------------------------------------------
    def _safe_update(self) -> None:
        """Observer-Callback (kommt aus beliebigen Threads)."""
        try:
            self.after(0, self._update_ui)
        except Exception:
            pass

    def _update_ui(self) -> None:
        try:
            if not self.winfo_exists():
                return
            self._fill(self.device_list, [
                f"{'🟢' if d.get('online') else '🔴'} {d.get('name')} ({d.get('ip')}, {d.get('type')})"
                for d in self.status.devices
            ], "Noch keine Geräte.")
            self._fill(self.client_list, [
                f"👤 {c.get('name')} ({c.get('role')}) – {c.get('device')} – zuletzt: {c.get('last_action')}"
                for c in self.status.clients
            ], "Keine Clients eingeloggt.")
            self._fill(self.workflow_list, [
                f"{self._wf_icon(w)} {w.get('name')} – {w.get('progress', 0)}% – {w.get('status')} (seit {w.get('started', '?')})"
                for w in self.status.workflows
            ], "Keine Workflows.")
            self._fill(self.test_list, [
                f"{'✅' if t.get('success') else '❌'} {t.get('name')}: {t.get('result')}"
                for t in self.status.test_results
            ], "Keine Testverbindungen.")

            load = self.status.system_load
            src = "live (Backend)" if self.status.backend_online else "offline (kein Backend, keine künstlichen Daten)"
            self.footer.configure(
                text=f"CPU: {load.get('cpu', '–')}% | RAM: {load.get('ram', '–')}%   ·   Quelle: {src}"
            )
        except Exception:
            pass

    @staticmethod
    def _wf_icon(w: dict) -> str:
        return {"running": "▶️", "active": "▶️", "success": "✅", "failed": "❌"}.get(
            w.get("status"), "⏸️")

    @staticmethod
    def _fill(frame: ctk.CTkScrollableFrame, items: list[str], empty_text: str) -> None:
        for widget in frame.winfo_children():
            widget.destroy()
        if not items:
            ctk.CTkLabel(frame, text=empty_text, text_color="#64748b").pack(anchor="w", padx=6, pady=4)
            return
        for text in items:
            ctk.CTkLabel(frame, text=text, anchor="w", justify="left").pack(anchor="w", padx=6, pady=2)
