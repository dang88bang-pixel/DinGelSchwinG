"""⚙️ Einstellungen: Systeminstruktionen, Modell-Backend, Aktionsbuttons."""
from __future__ import annotations

import os
from typing import Callable

import customtkinter as ctk

from ..utils.agent import Agent
from ..utils.config import save_config

ENGINES = ["auto", "none", "llamacpp", "ollama", "openai"]
ENGINE_LABELS = {
    "auto": "Auto (erkennen)",
    "none": "Deterministisch (kein LLM)",
    "llamacpp": "Lokal (llama.cpp / GGUF)",
    "ollama": "Ollama (localhost:11434)",
    "openai": "OpenAI-kompatible API",
}


class SettingsView(ctk.CTkFrame):
    """Einstellungen: speichert in data/config.json, wendet Änderungen sofort an."""

    def __init__(self, master, agent: Agent, on_saved: Callable[[], None] | None = None) -> None:
        super().__init__(master, fg_color="transparent")
        self.agent = agent
        self.on_saved = on_saved

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        ctk.CTkLabel(self, text="⚙️ Einstellungen",
                     font=ctk.CTkFont(size=18, weight="bold")).grid(row=0, column=0, sticky="w", padx=10, pady=10)

        tabs = ctk.CTkTabview(self)
        tabs.grid(row=1, column=0, sticky="nsew", padx=10, pady=(0, 10))
        self.tabs = tabs

        self._build_system_tab(tabs.add("System"))
        self._build_model_tab(tabs.add("Modell"))
        self._build_buttons_tab(tabs.add("Buttons"))

    # ------------------------------------------------------------------
    def _build_system_tab(self, tab) -> None:
        tab.grid_columnconfigure(0, weight=1)
        tab.grid_rowconfigure(1, weight=1)

        # Modus-Auswahl (A: Normaler Chat | B: ADB-Aktion | custom)
        mode_row = ctk.CTkFrame(tab, fg_color="transparent")
        mode_row.grid(row=0, column=0, sticky="ew", padx=6, pady=(6, 2))
        mode_row.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(mode_row, text="Modus:", font=ctk.CTkFont(size=13, weight="bold")).pack(side="left", padx=4)

        from ..utils.agent import MODE_LABELS
        self.mode_menu = ctk.CTkOptionMenu(
            mode_row, values=list(MODE_LABELS.values()),
            command=lambda _v: self._on_mode_change())
        self.mode_menu.set(MODE_LABELS.get(self.agent.mode, "A: Normaler Chat"))
        self.mode_menu.pack(side="left", padx=4, fill="x", expand=True)

        ctk.CTkLabel(mode_row, text="Systemanweisung (editierbar):",
                     text_color="#94a3b8", font=ctk.CTkFont(size=12)).pack(side="left", padx=8)

        self.sys_text = ctk.CTkTextbox(tab, font=ctk.CTkFont(size=13))
        self.sys_text.grid(row=1, column=0, sticky="nsew", padx=6, pady=6)
        self._load_instruction_text()

        bar = ctk.CTkFrame(tab, fg_color="transparent")
        bar.grid(row=2, column=0, sticky="ew", padx=6, pady=6)
        ctk.CTkButton(bar, text="💾 Anweisung speichern",
                      command=self._save_system).pack(side="left", padx=4)
        ctk.CTkButton(bar, text="↩️ Standard wiederherstellen",
                      command=self._restore_default).pack(side="left", padx=4)
        ctk.CTkButton(bar, text="🔄 skillz.md neu laden",
                      command=self._reload_skills).pack(side="left", padx=4)

    def _on_mode_change(self) -> None:
        """Modus wechseln: Agent umschalten + Anweisungstext neu laden."""
        labels_to_keys = {v: k for k, v in MODE_LABELS.items()}
        mode = labels_to_keys.get(self.mode_menu.get(), "chat")
        result = self.agent.set_mode(mode)
        self._load_instruction_text()
        self._flash(result.split("\n")[0])

    def _load_instruction_text(self) -> None:
        self.sys_text.delete("1.0", "end")
        self.sys_text.insert("1.0", self.agent.system_instruction)

    def _save_system(self) -> None:
        text = self.sys_text.get("1.0", "end-1c")
        self._flash(self.agent.save_instruction(text))

    def _restore_default(self) -> None:
        """Setzt die Anweisung des aktiven Modus auf den mitgelieferten Standard zurück."""
        from ..utils.skill_loader import SYSTEM_INSTRUCTION_PATHS
        import shutil
        mode = self.agent.mode
        src = SYSTEM_INSTRUCTION_PATHS.get(mode)
        if src and os.path.isfile(src):
            with open(src, "r", encoding="utf-8") as f:
                default_text = f.read()
        else:
            default_text = self.agent.system_instruction
        self.sys_text.delete("1.0", "end")
        self.sys_text.insert("1.0", default_text)
        self._flash(self.agent.save_instruction(default_text))

    def _reload_skills(self) -> None:
        from ..utils.skill_loader import load_skills
        self.agent.skills = load_skills(self.agent.mode)
        self._flash(f"{self.agent.mode_label()}: skillz.md neu geladen "
                    f"({len(self.agent.skills)} Skills) ✓")

    # ------------------------------------------------------------------
    def _build_model_tab(self, tab) -> None:
        tab.grid_columnconfigure(0, weight=1)
        cfg = self.agent.config

        engine_label = ENGINE_LABELS.get(str(cfg.get("engine", "auto")), "auto")
        self.engine_menu = ctk.CTkOptionMenu(tab, values=list(ENGINE_LABELS.values()),
                                             command=lambda _v: None)
        self.engine_menu.set(engine_label)
        self.engine_menu.grid(row=0, column=0, sticky="ew", padx=6, pady=6)

        self.model_entry = self._labeled_entry(tab, 1, "Modell-Name (z.B. qwen2.5:0.5b)", cfg.get("model", ""))
        self.path_entry = self._labeled_entry(tab, 2, "GGUF-Pfad (llama.cpp, leer = auto-suchen)", cfg.get("model_path", ""))
        self.base_entry = self._labeled_entry(tab, 3, "Base-URL (Ollama/API)", cfg.get("base_url", ""))
        self.key_entry = self._labeled_entry(tab, 4, "API-Key (nur OpenAI-kompatibel)", cfg.get("api_key", ""))

        bar = ctk.CTkFrame(tab, fg_color="transparent")
        bar.grid(row=5, column=0, sticky="ew", padx=6, pady=6)
        ctk.CTkButton(bar, text="💾 Modell übernehmen & testen",
                      command=self._save_model).pack(side="left", padx=4)

        self.model_status = ctk.CTkLabel(tab, text=f"🧠 Aktiv: {self.agent.model_status()}",
                                         anchor="w", text_color="#7dd3fc")
        self.model_status.grid(row=6, column=0, sticky="ew", padx=8, pady=4)

        ctk.CTkLabel(tab, text="Hinweis: GGUF-Modell herunterladen mit:\n"
                     "python tools/download_model.py\n"
                     "Oder Ollama:  ollama pull qwen2.5:0.5b",
                     text_color="#64748b", justify="left", anchor="w").grid(
            row=7, column=0, sticky="ew", padx=8, pady=6)

    def _labeled_entry(self, tab, row: int, label: str, value: str) -> ctk.CTkEntry:
        ctk.CTkLabel(tab, text=label, anchor="w", text_color="#94a3b8",
                     font=ctk.CTkFont(size=12)).grid(row=row * 2 - 1, column=0, sticky="ew", padx=8, pady=(4, 0))
        entry = ctk.CTkEntry(tab, placeholder_text=label)
        entry.insert(0, value)
        entry.grid(row=row * 2, column=0, sticky="ew", padx=8, pady=(0, 4))
        return entry

    def _save_model(self) -> None:
        labels_to_keys = {v: k for k, v in ENGINE_LABELS.items()}
        engine = labels_to_keys.get(self.engine_menu.get(), "auto")
        self.agent.config.update({
            "engine": engine,
            "model": self.model_entry.get().strip() or "qwen2.5:0.5b",
            "model_path": self.path_entry.get().strip(),
            "base_url": self.base_entry.get().strip() or "http://localhost:11434",
            "api_key": self.key_entry.get().strip(),
        })
        save_config(self.agent.config)
        self.agent.set_backend(self.agent.config)
        self.model_status.configure(text=f"🧠 Aktiv: {self.agent.model_status()}")
        self._flash("Modell-Backend übernommen ✓")

    # ------------------------------------------------------------------
    def _build_buttons_tab(self, tab) -> None:
        tab.grid_columnconfigure(0, weight=1)
        header = ctk.CTkFrame(tab, fg_color="transparent")
        header.grid(row=0, column=0, sticky="ew", padx=6, pady=4)
        ctk.CTkLabel(header, text="Aktionsbuttons (frei belegbar)", anchor="w",
                     font=ctk.CTkFont(size=14, weight="bold")).pack(side="left")
        ctk.CTkButton(header, text="💾 Speichern", command=self._save_buttons).pack(side="right")

        self.button_entries: list[list[ctk.CTkEntry]] = []
        for i in range(6):
            button = self.agent.get_button(i)
            row = ctk.CTkFrame(tab, fg_color="transparent")
            row.grid(row=i + 1, column=0, sticky="ew", padx=6, pady=2)
            row.grid_columnconfigure(0, weight=0)
            row.grid_columnconfigure(1, weight=0)
            row.grid_columnconfigure(2, weight=1)

            label_entry = ctk.CTkEntry(row, width=60)
            label_entry.insert(0, button.get("label", "🔘"))
            label_entry.grid(row=0, column=0, padx=2)
            action_entry = ctk.CTkEntry(row, width=220)
            action_entry.insert(0, button.get("action", ""))
            action_entry.grid(row=0, column=1, padx=2)
            desc_entry = ctk.CTkEntry(row)
            desc_entry.insert(0, button.get("desc", ""))
            desc_entry.grid(row=0, column=2, sticky="ew", padx=2)
            self.button_entries.append([label_entry, action_entry, desc_entry])

        ctk.CTkLabel(tab, text="Aktionen: attach | export | audit | stop | clear_cache |\n"
                     "script:<datei.py> | workflow:<name> | task:<beschreibung>",
                     text_color="#64748b", justify="left", anchor="w", font=ctk.CTkFont(size=12)).grid(
            row=7, column=0, sticky="ew", padx=8, pady=6)

    def _save_buttons(self) -> None:
        for i, (label_e, action_e, desc_e) in enumerate(self.button_entries):
            self.agent.assign_button(i, action_e.get().strip(), desc_e.get().strip())
            self.agent.set_button_label(i, label_e.get().strip())
        self.agent.config["buttons"] = [
            {"label": self.agent.get_button(i)["label"],
             "action": self.agent.get_button(i)["action"],
             "desc": self.agent.get_button(i)["desc"]} for i in range(6)
        ]
        save_config(self.agent.config)
        if self.on_saved:
            self.on_saved()
        self._flash("Buttons gespeichert ✓")

    # ------------------------------------------------------------------
    def _flash(self, text: str) -> None:
        label = ctk.CTkLabel(self, text=text, text_color="#4ade80", font=ctk.CTkFont(size=12))
        label.grid(row=2, column=0, sticky="e", padx=12)
        self.after(2500, label.destroy)
