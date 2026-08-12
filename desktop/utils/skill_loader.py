"""Lädt Skill-Definitionen aus skillz.md und Systeminstruktionen (modusabhängig)."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

# Modus A: Normaler Chat | Modus B: ADB-Aktion | Modus C: BLE Professional Suite | custom
MODES = ("chat", "adb", "ble", "custom")

SKILLZ_PATHS = {
    "chat": os.path.join(DATA_DIR, "skillz.md"),
    "adb": os.path.join(DATA_DIR, "skillz_adb.md"),
    "ble": os.path.join(DATA_DIR, "skillz_ble.md"),
}
SYSTEM_INSTRUCTION_PATHS = {
    "chat": os.path.join(DATA_DIR, "system_instruction_chat.txt"),
    "adb": os.path.join(DATA_DIR, "system_instruction_adb.txt"),
    "ble": os.path.join(DATA_DIR, "system_instruction_ble.txt"),
    "custom": os.path.join(DATA_DIR, "system_instruction_custom.txt"),
}
# Kompatibilität: alte Aufrufe ohne Modus
SKILLZ_PATH = SKILLZ_PATHS["chat"]
SYSTEM_INSTRUCTION_PATH = SYSTEM_INSTRUCTION_PATHS["chat"]

_DEFAULT_SYSTEM_INSTRUCTION = (
    "Du bist ein hilfreicher Assistent für Netzwerk- und Systemadministration. "
    "Antworte auf Deutsch."
)


@dataclass
class Skill:
    """Eine einzelne Skill-Definition aus skillz.md."""

    name: str
    description: str = ""
    calls: list[str] = field(default_factory=list)
    params: str = ""
    example: str = ""

    def to_text(self) -> str:
        parts = [f"- {self.name}: {self.description}"]
        if self.calls:
            parts.append(f"    Aufruf: {' | '.join(self.calls)}")
        if self.params:
            parts.append(f"    Parameter: {self.params}")
        if self.example:
            parts.append(f"    Beispiel: {self.example}")
        return "\n".join(parts)


def _normalize_mode(mode: str | None) -> str:
    return mode if mode in MODES else "chat"


def load_skills(mode: str | None = None, path: str | None = None) -> list[Skill]:
    """Parst skillz.md: Abschnitte '## <name>' mit Schlüssel/Wert-Zeilen."""
    mode = _normalize_mode(mode)
    path = path or SKILLZ_PATHS.get(mode, SKILLZ_PATHS["chat"])
    skills: list[Skill] = []
    if not os.path.isfile(path):
        return skills
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.read().splitlines()
    except OSError:
        return skills

    current: Skill | None = None
    for raw in lines:
        line = raw.strip()
        header = re.match(r"^##\s+([a-zA-Z_][\w-]*)\s*$", line)
        if header:
            current = Skill(name=header.group(1))
            skills.append(current)
            continue
        if not line or line.startswith("#"):
            continue
        if current is None:
            continue
        key, sep, value = line.partition(":")
        key = key.strip().lower()
        value = value.strip()
        if not sep:
            continue
        if key in ("beschreibung", "description"):
            current.description = value
        elif key in ("aufruf", "calls"):
            current.calls = [c.strip() for c in value.split("|")]
        elif key in ("parameter", "params"):
            current.params = value
        elif key in ("beispiel", "example"):
            current.example = value
    return skills


def load_system_instruction(mode: str | None = None, path: str | None = None) -> str:
    mode = _normalize_mode(mode)
    path = path or SYSTEM_INSTRUCTION_PATHS.get(mode, SYSTEM_INSTRUCTION_PATHS["chat"])
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read().strip()
        return content or _DEFAULT_SYSTEM_INSTRUCTION
    except OSError:
        return _DEFAULT_SYSTEM_INSTRUCTION


def save_system_instruction(text: str, mode: str | None = None, path: str | None = None) -> bool:
    mode = _normalize_mode(mode)
    path = path or SYSTEM_INSTRUCTION_PATHS.get(mode, SYSTEM_INSTRUCTION_PATHS["chat"])
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text.strip() + "\n")
        return True
    except OSError:
        return False


def skills_to_prompt(skills: list[Skill]) -> str:
    if not skills:
        return "Keine Skills geladen."
    return "Verfügbare Skills:\n" + "\n".join(s.to_text() for s in skills)
