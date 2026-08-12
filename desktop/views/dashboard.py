"""📊 Dashboard-View: kompakte Übersicht der Status-Kennzahlen."""
from __future__ import annotations

import customtkinter as ctk

from ..utils.status_manager import StatusManager


class DashboardView(ctk.CTkFrame):
    """Startansicht mit Kennzahlen-Karten (live aus dem StatusManager)."""

    def __init__(self, master, status: StatusManager) -> None:
        super().__init__(master, fg_color="transparent")
        self.status = status

        ctk.CTkLabel(self, text="📊 Dashboard",
                     font=ctk.CTkFont(size=22, weight="bold")).pack(anchor="w", padx=16, pady=(14, 4))
        ctk.CTkLabel(self, text="DinGelSchwinG v3.0 – Agent Console · Master-Station",
                     text_color="#94a3b8").pack(anchor="w", padx=16)

        cards = ctk.CTkFrame(self, fg_color="transparent")
        cards.pack(fill="x", padx=16, pady=16)
        for i in range(4):
            cards.grid_columnconfigure(i, weight=1)

        self.device_card = self._card(cards, 0, "🟢 Geräte", "–")
        self.client_card = self._card(cards, 1, "👥 Clients", "–")
        self.workflow_card = self._card(cards, 2, "⚡ Workflows", "–")
        self.state_card = self._card(cards, 3, "🛡️ Zustand", "–")

        self.detail = ctk.CTkLabel(self, text="", anchor="w", justify="left",
                                   text_color="#cbd5e1", font=ctk.CTkFont(size=13))
        self.detail.pack(fill="x", padx=16, pady=8)

        self.status.register_observer(self._safe_update)
        self.after(300, self.update_cards)

    def _card(self, master, col: int, title: str, value: str) -> ctk.CTkLabel:
        frame = ctk.CTkFrame(master, corner_radius=14, fg_color="#0b1220")
        frame.grid(row=0, column=col, sticky="ew", padx=4)
        ctk.CTkLabel(frame, text=title, text_color="#94a3b8", font=ctk.CTkFont(size=12)).pack(pady=(10, 0))
        label = ctk.CTkLabel(frame, text=value, font=ctk.CTkFont(size=26, weight="bold"))
        label.pack(pady=(0, 10))
        return label

    def _safe_update(self) -> None:
        try:
            self.after(0, self.update_cards)
        except Exception:
            pass

    def update_cards(self) -> None:
        try:
            self.device_card.configure(text=str(self.status.connected_devices()))
            self.client_card.configure(text=str(self.status.client_count()))
            self.workflow_card.configure(text=str(self.status.active_workflows()))
            self.state_card.configure(text="IDLE" if self.status.idle() else "BUSY")
            names = ", ".join(w.get("name", "?") for w in self.status.workflows) or "keine"
            src = "Live (Backend)" if self.status.backend_online else "Mock (offline)"
            self.detail.configure(
                text=f"Geräte: {', '.join(d.get('name','') for d in self.status.devices[:5])}\n"
                     f"Workflows: {names}\nQuelle: {src}")
        except Exception:
            pass
