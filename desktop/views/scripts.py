"""🛠️ Skripte-Galerie: CRUD + Editor + Testen/Ausführen (RBAC für Löschen)."""
from __future__ import annotations

import os
from datetime import datetime
from typing import Callable

import customtkinter as ctk

from ..utils.script_executor import ScriptExecutor, ScriptResult

DESC_PREFIXES = ("\"\"\"", "'''", "# ", "// ")


def _describe(path: str) -> str:
    """Erste Zeile des Skripts als Kurzbeschreibung verwenden."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                stripped = line.strip()
                if not stripped:
                    continue
                if stripped.startswith(("#!", "#!/")):
                    continue
                for prefix in DESC_PREFIXES:
                    if stripped.startswith(prefix):
                        return stripped[len(prefix):].strip()
                return stripped[:80]
    except OSError:
        return ""
    return ""


class ScriptsView(ctk.CTkFrame):
    """Skripte-Galerie mit Bearbeiten/Testen/Ausführen/Löschen."""

    def __init__(self, master, executor: ScriptExecutor, role: str = "admin",
                 on_output: Callable[[str], None] | None = None) -> None:
        super().__init__(master, fg_color="transparent")
        self.executor = executor
        self.role = role
        self.on_output = on_output or (lambda _t: None)
        self._editor: ctk.CTkToplevel | None = None

        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(1, weight=1)

        toolbar = ctk.CTkFrame(self, fg_color="transparent")
        toolbar.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 4))
        ctk.CTkLabel(toolbar, text="🛠️ Skripte-Galerie",
                     font=ctk.CTkFont(size=18, weight="bold")).pack(side="left")
        ctk.CTkButton(toolbar, text="➕ Neu", width=80, command=self._new_script).pack(side="right", padx=4)
        ctk.CTkButton(toolbar, text="🔄 Aktualisieren", width=120, command=self.reload).pack(side="right", padx=4)

        self.list_frame = ctk.CTkScrollableFrame(self, fg_color="#020617")
        self.list_frame.grid(row=1, column=0, sticky="nsew", padx=10, pady=(0, 10))
        self.list_frame.grid_columnconfigure(0, weight=1)

        self.reload()

    # ------------------------------------------------------------------
    def reload(self) -> None:
        for widget in self.list_frame.winfo_children():
            widget.destroy()
        for name in self.executor.list_scripts():
            self._add_card(name)

    def _add_card(self, name: str) -> None:
        path = os.path.join(self.executor.scripts_dir, name)
        created = datetime.fromtimestamp(os.path.getmtime(path)).strftime("%Y-%m-%d %H:%M")

        card = ctk.CTkFrame(self.list_frame, corner_radius=12, fg_color="#0b1220")
        card.grid(row=len(self.list_frame.winfo_children()), column=0, sticky="ew", padx=4, pady=4)
        card.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(card, text="📄", font=ctk.CTkFont(size=20)).grid(row=0, column=0, rowspan=2, padx=(12, 6))
        ctk.CTkLabel(card, text=name, font=ctk.CTkFont(size=14, weight="bold"), anchor="w").grid(
            row=0, column=1, sticky="ew", padx=4, pady=(8, 0))
        desc = _describe(path)
        ctk.CTkLabel(card, text=f"{desc or '–'}  ·  {created}", text_color="#94a3b8",
                     anchor="w", justify="left", font=ctk.CTkFont(size=12)).grid(
            row=1, column=1, sticky="ew", padx=4, pady=(0, 8))

        actions = ctk.CTkFrame(card, fg_color="transparent")
        actions.grid(row=0, column=2, rowspan=2, padx=8, pady=6)
        ctk.CTkButton(actions, text="✏️", width=40, command=lambda: self._edit_script(name)).pack(side="left", padx=2)
        ctk.CTkButton(actions, text="🧪", width=40, command=lambda: self._run_script(name, 10)).pack(side="left", padx=2)
        ctk.CTkButton(actions, text="▶️", width=40, command=lambda: self._run_script(name, 60)).pack(side="left", padx=2)
        ctk.CTkButton(actions, text="🗑️", width=40, fg_color="#7f1d1d", hover_color="#991b1b",
                      command=lambda: self._delete_script(name)).pack(side="left", padx=2)

    # ------------------------------------------------------------------
    def _run_script(self, name: str, timeout: float) -> None:
        self.on_output(f"▶️ Starte {name} (Timeout {timeout:.0f}s) …")

        def done(result: ScriptResult) -> None:
            self.on_output(result.to_text())

        self.executor.run(name, args=[], timeout=timeout, on_done=done)

    def _delete_script(self, name: str) -> None:
        if self.role != "admin":
            self.on_output("⛔ Keine Berechtigung: Nur Admins dürfen Skripte löschen.")
            return
        path = os.path.join(self.executor.scripts_dir, name)
        try:
            os.remove(path)
            self.on_output(f"🗑️ Skript '{name}' gelöscht.")
            self.reload()
        except OSError as exc:
            self.on_output(f"❌ Löschen fehlgeschlagen: {exc}")

    def _new_script(self) -> None:
        name = f"script_{len(self.executor.list_scripts()) + 1}.py"
        path = os.path.join(self.executor.scripts_dir, name)
        template = '"""Neues Skript – Beschreibung hier."""\n\n\ndef main():\n    print("Hallo von ' + name + '")\n\n\nif __name__ == "__main__":\n    main()\n'
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(template)
        except OSError as exc:
            self.on_output(f"❌ Anlegen fehlgeschlagen: {exc}")
            return
        self.reload()
        self._edit_script(name)

    def _edit_script(self, name: str) -> None:
        path = os.path.join(self.executor.scripts_dir, name)
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except OSError as exc:
            self.on_output(f"❌ Lesen fehlgeschlagen: {exc}")
            return

        editor = ctk.CTkToplevel(self)
        editor.title(f"✏️ Editor – {name}")
        editor.geometry("720x560")
        textbox = ctk.CTkTextbox(editor, font=ctk.CTkFont(size=13, family="Consolas"))
        textbox.pack(fill="both", expand=True, padx=10, pady=10)
        textbox.insert("1.0", content)

        bar = ctk.CTkFrame(editor, fg_color="transparent")
        bar.pack(fill="x", padx=10, pady=(0, 10))

        def save() -> None:
            try:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(textbox.get("1.0", "end-1c"))
                self.on_output(f"💾 '{name}' gespeichert.")
                editor.destroy()
                self.reload()
            except OSError as exc:
                self.on_output(f"❌ Speichern fehlgeschlagen: {exc}")

        ctk.CTkButton(bar, text="💾 Speichern", command=save).pack(side="left", padx=4)
        ctk.CTkButton(bar, text="Abbrechen", fg_color="#334155", hover_color="#475569",
                      command=editor.destroy).pack(side="left", padx=4)
        self._editor = editor
