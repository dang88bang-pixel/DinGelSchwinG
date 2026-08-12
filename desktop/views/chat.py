"""💬 Chat-Bereich: Messenger-Stil, 6 frei belegbare Aktionsbuttons, Status-Bar."""
from __future__ import annotations

import tkinter as tk
from tkinter import filedialog

import customtkinter as ctk

from ..utils.agent import Agent

BUBBLE_COLORS = {
    "user": ("#1e3a8a", "#dbeafe"),    # (bg, fg)
    "agent": ("#0f172a", "#e2e8f0"),
    "system": ("#1a2e05", "#d9f99d"),
}


class ChatView(ctk.CTkFrame):
    """Chat-Ansicht mit Nachrichtenverlauf, 6 Aktionsbuttons und Eingabezeile."""

    def __init__(self, master, agent: Agent, on_open_settings=None, on_open_status=None) -> None:
        super().__init__(master, fg_color="transparent")
        self.agent = agent
        self.on_open_settings = on_open_settings
        self.on_open_status = on_open_status
        self._pending = False

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(0, weight=1)   # Nachrichten
        self.grid_rowconfigure(1, weight=0)   # Aktionsbuttons
        self.grid_rowconfigure(2, weight=0)   # Eingabe
        self.grid_rowconfigure(3, weight=0)   # Status-Zeile

        self._build_chat_area()
        self._build_action_buttons()
        self._build_input()
        self._build_status_row()

        self._welcome()

    # ------------------------------------------------------------------
    def _build_chat_area(self) -> None:
        self.chat_display = ctk.CTkScrollableFrame(self, label_text="💬 Chat", fg_color="#020617")
        self.chat_display.grid(row=0, column=0, sticky="nsew", padx=10, pady=(10, 5))
        self.chat_display.grid_columnconfigure(0, weight=1)

    def _build_action_buttons(self) -> None:
        bar = ctk.CTkFrame(self, fg_color="transparent")
        bar.grid(row=1, column=0, sticky="ew", padx=10, pady=5)
        self.action_buttons: list[ctk.CTkButton] = []
        for i in range(6):
            btn = ctk.CTkButton(bar, text=self.agent.get_button(i)["label"], width=64, height=44,
                                corner_radius=12, font=ctk.CTkFont(size=18),
                                command=lambda idx=i: self._on_action(idx))
            btn.grid(row=0, column=i, padx=5, pady=2)
            self.action_buttons.append(btn)
        for col in range(6):
            bar.grid_columnconfigure(col, weight=1)

    def _build_input(self) -> None:
        row = ctk.CTkFrame(self, fg_color="transparent")
        row.grid(row=2, column=0, sticky="ew", padx=10, pady=(0, 5))
        row.grid_columnconfigure(0, weight=1)

        self.input_entry = ctk.CTkEntry(row, placeholder_text="Nachricht eingeben… (Enter zum Senden)")
        self.input_entry.grid(row=0, column=0, sticky="ew")
        self.input_entry.bind("<Return>", lambda _e: self._send())

        self.send_btn = ctk.CTkButton(row, text="Senden", width=100, command=self._send)
        self.send_btn.grid(row=0, column=1, padx=(10, 0))

    def _build_status_row(self) -> None:
        row = ctk.CTkFrame(self, fg_color="#0f172a", corner_radius=10)
        row.grid(row=3, column=0, sticky="ew", padx=10, pady=(5, 10))
        row.grid_columnconfigure(0, weight=1)

        self.status_label = ctk.CTkLabel(row, text="🟢 Geräte: –  |  👥 Clients: –  |  ⚡ Workflows: –  |  🛡️ –",
                                         anchor="w", font=ctk.CTkFont(size=12))
        self.status_label.grid(row=0, column=0, sticky="ew", padx=10, pady=6)

        self.model_label = ctk.CTkLabel(row, text=f"🧠 {self.agent.model_status()}",
                                        font=ctk.CTkFont(size=11), text_color="#7dd3fc",
                                        cursor="hand2")
        self.model_label.grid(row=0, column=1, padx=10)
        self.model_label.bind("<Button-1>", lambda _e: self._open_settings())

    # ------------------------------------------------------------------
    # Nachrichten
    # ------------------------------------------------------------------
    def _welcome(self) -> None:
        self.add_message("system", "Willkommen bei der DinGelSchwinG Agent Console v3.0.\n"
                         "Ich steuere Geräte, Clients und Workflows per Chat.\n"
                         "Tippe „hilfe“, um meine Fähigkeiten zu sehen.")

    def add_message(self, sender: str, text: str) -> None:
        """Fügt eine Nachricht hinzu (thread-sicher)."""
        self.after(0, lambda: self._add_message(sender, text))

    def _add_message(self, sender: str, text: str) -> None:
        bubble = ctk.CTkFrame(self.chat_display, fg_color=BUBBLE_COLORS.get(sender, BUBBLE_COLORS["system"])[0],
                              corner_radius=14)
        bubble.pack(fill="x", padx=6, pady=4, anchor="e" if sender == "user" else "w")
        bubble.grid_columnconfigure(0, weight=1)

        name = "Du" if sender == "user" else ("Agent" if sender == "agent" else "System")
        name_label = ctk.CTkLabel(bubble, text=name, font=ctk.CTkFont(size=11, weight="bold"),
                                  text_color="#94a3b8", anchor="w")
        name_label.grid(row=0, column=0, sticky="w", padx=10, pady=(6, 0))

        text_widget = self._make_text_widget(bubble, text)
        text_widget.grid(row=1, column=0, sticky="ew", padx=8, pady=(2, 6))

        self._scroll_to_bottom()

    def _make_text_widget(self, master, text: str) -> tk.Text:
        fg = BUBBLE_COLORS.get("system", {})  # placeholder
        # Farbe je Sender wird vom Bubble-Frame geerbt – wir wählen kontrastreich:
        bg = master.cget("fg_color")
        fg_color = "#e2e8f0"
        if bg == BUBBLE_COLORS["user"][0]:
            fg_color = BUBBLE_COLORS["user"][1]
        elif bg == BUBBLE_COLORS["agent"][0]:
            fg_color = BUBBLE_COLORS["agent"][1]
        elif bg == BUBBLE_COLORS["system"][0]:
            fg_color = BUBBLE_COLORS["system"][1]

        lines = max(2, text.count("\n") + 1 + len(text) // 80)
        widget = tk.Text(master, height=min(lines, 16), wrap="word", bg=bg, fg=fg_color,
                         insertbackground=fg_color, relief="flat", borderwidth=0,
                         padx=4, pady=2, font=ctk.CTkFont(size=13))
        widget.configure(state="normal")
        self._insert_markdown(widget, text)
        widget.configure(state="disabled")
        return widget

    def _insert_markdown(self, widget: tk.Text, text: str) -> None:
        """Minimal-Markdown: **fett**, *kursiv*, `code`, ```Blöcke```, Listen."""
        widget.tag_configure("bold", font=ctk.CTkFont(size=13, weight="bold"))
        widget.tag_configure("italic", font=ctk.CTkFont(size=13, slant="italic"))
        widget.tag_configure("code", background="#020617", foreground="#7dd3fc",
                             font=ctk.CTkFont(size=12, family="Consolas"))
        widget.tag_configure("bullet", lmargin1=16, lmargin2=16)

        in_block = False
        for line in text.split("\n"):
            if line.strip().startswith("```"):
                in_block = not in_block
                continue
            if in_block:
                widget.insert("end", line + "\n", "code")
                continue
            stripped = line.lstrip()
            if stripped.startswith(("- ", "• ")):
                widget.insert("end", "  • " + stripped[2:] + "\n", "bullet")
                continue
            self._insert_inline(widget, line)

    @staticmethod
    def _insert_inline(widget: tk.Text, line: str) -> None:
        pattern = r"(\*\*.+?\*\*|\*.+?\*|`.+?`)"
        pos = 0
        for match in __import__("re").finditer(pattern, line):
            if match.start() > pos:
                widget.insert("end", line[pos:match.start()])
            token = match.group(0)
            if token.startswith("**"):
                widget.insert("end", token[2:-2], "bold")
            elif token.startswith("`"):
                widget.insert("end", token[1:-1], "code")
            elif token.startswith("*"):
                widget.insert("end", token[1:-1], "italic")
            pos = match.end()
        widget.insert("end", line[pos:] + "\n")

    def _scroll_to_bottom(self) -> None:
        try:
            canvas = self.chat_display._parent_canvas
            canvas.yview_moveto(1.0)
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Senden & Aktionen
    # ------------------------------------------------------------------
    def _send(self) -> None:
        text = self.input_entry.get().strip()
        if not text or self._pending:
            return
        self.input_entry.delete(0, "end")
        self._add_message("user", text)
        self._pending = True
        self.send_btn.configure(state="disabled")
        self.agent.ask(text, self._on_agent_response)

    def _on_agent_response(self, response: str) -> None:
        self.after(0, lambda: self._finish_response(response))

    def _finish_response(self, response: str) -> None:
        self._add_message("agent", response)
        self._pending = False
        self.send_btn.configure(state="normal")
        self.input_entry.focus_set()

    def _on_action(self, idx: int) -> None:
        button = self.agent.get_button(idx)
        action = button.get("action", "")
        if action == "attach":
            path = filedialog.askopenfilename(title="Skript hochladen",
                                              filetypes=[("Alle Dateien", "*.*")])
            if path:
                self.add_message("system", self.agent.attach_file(path))
            return
        self.add_message("system", f"▶️ Führe Aktion aus: {button.get('desc') or action}")
        self._pending = True

        def work() -> None:
            result = self.agent.execute_action(idx)
            self.after(0, lambda: self._finish_action(result))

        import threading
        threading.Thread(target=work, daemon=True).start()

    def _finish_action(self, result: str) -> None:
        self._add_message("system", result)
        self._pending = False

    # ------------------------------------------------------------------
    # Status-Bar
    # ------------------------------------------------------------------
    def update_status_bar(self, text: str) -> None:
        try:
            self.status_label.configure(text=text)
        except Exception:
            pass

    def refresh_buttons(self) -> None:
        for i, btn in enumerate(self.action_buttons):
            btn.configure(text=self.agent.get_button(i)["label"])

    def _open_settings(self) -> None:
        if self.on_open_settings:
            self.on_open_settings()
