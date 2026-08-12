"""Lädt Skill-Definitionen aus skillz.md und Systeminstruktionen."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
SKILLZ_PATH = os.path.join(DATA_DIR, "skillz.md")
SYSTEM_INSTRUCTION_PATH = os.path.join(DATA_DIR, "system_instruction.txt")

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


def load_skills(path: str | None = None) -> list[Skill]:
    """Parst skillz.md: Abschnitte '## <name>' mit Schlüssel/Wert-Zeilen."""
    path = path or SKILLZ_PATH
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
        if key == "beschreibung" or key == "description":
            current.description = value
        elif key == "aufruf" or key == "calls":
            current.calls = [c.strip() for c in value.split("|")]
        elif key == "parameter" or key == "params":
            current.params = value
        elif key == "beispiel" or key == "example":
            current.example = value
    return skills


def load_system_instruction(path: str | None = None) -> str:
    path = path or SYSTEM_INSTRUCTION_PATH
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read().strip()
        return content or _DEFAULT_SYSTEM_INSTRUCTION
    except OSError:
        return _DEFAULT_SYSTEM_INSTRUCTION


def save_system_instruction(text: str, path: str | None = None) -> bool:
    path = path or SYSTEM_INSTRUCTION_PATH
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
