"""Modell-Backends für den Agenten.

Unterstützte Engines (fallback-sicher, nie ein Hard-Dependency):
- "none"      → deterministische Skill-Engine (immer verfügbar)
- "llamacpp"  → lokales GGUF-Modell via llama-cpp-python (Qwen2.5-0.5B-Instruct empfohlen)
- "ollama"    → lokaler Ollama-Server (http://localhost:11434)
- "openai"    → beliebige OpenAI-kompatible API
- "auto"      → erkennt automatisch, was verfügbar ist

Empfohlenes Embedded-Modell: Qwen2.5-0.5B-Instruct (GGUF Q4_K_M, ~400 MB)
Download: python tools/download_model.py
"""
from __future__ import annotations

import glob
import json
import os
import urllib.error
import urllib.request
from typing import Any

MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "models")


class BackendError(Exception):
    """Wird geworfen, wenn ein Backend nicht verfügbar ist oder fehlschlägt."""


class ModelBackend:
    """Basis-Klasse für alle Modell-Backends."""

    name = "none"
    is_llm = False

    def generate(self, system_prompt: str, user_message: str) -> str:
        raise NotImplementedError

    def describe(self) -> str:
        return "deterministisch (kein LLM)"


# --------------------------------------------------------------------------
# Deterministisches Backend (immer verfügbar, Grundlage der App)
# --------------------------------------------------------------------------
class DeterministicBackend(ModelBackend):
    name = "none"
    is_llm = False

    def describe(self) -> str:
        return "deterministische Skill-Engine (offline, immer verfügbar)"


# --------------------------------------------------------------------------
# llama.cpp / GGUF
# --------------------------------------------------------------------------
class LlamaCppBackend(ModelBackend):
    name = "llamacpp"
    is_llm = True

    def __init__(self, model_path: str | None = None) -> None:
        self.model_path = model_path or self._find_model()
        self._llm: Any = None

    @staticmethod
    def _find_model() -> str | None:
        if not os.path.isdir(MODELS_DIR):
            return None
        matches = sorted(glob.glob(os.path.join(MODELS_DIR, "*.gguf")))
        return matches[0] if matches else None

    def _ensure(self) -> Any:
        if self._llm is not None:
            return self._llm
        try:
            from llama_cpp import Llama  # type: ignore
        except ImportError as exc:
            raise BackendError(
                "llama-cpp-python ist nicht installiert.\n"
                "Installation: pip install llama-cpp-python\n"
                "Modell: python tools/download_model.py"
            ) from exc
        if not self.model_path or not os.path.isfile(self.model_path):
            raise BackendError(
                f"Kein GGUF-Modell gefunden ({self.model_path}).\n"
                "Lade ein Modell herunter: python tools/download_model.py"
            )
        self._llm = Llama(model_path=self.model_path, n_ctx=2048, verbose=False)
        return self._llm

    def generate(self, system_prompt: str, user_message: str) -> str:
        llm = self._ensure()
        resp = llm.create_chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            max_tokens=256,
            temperature=0.7,
        )
        content = resp["choices"][0]["message"]["content"]
        return content if isinstance(content, str) else str(content)

    def describe(self) -> str:
        return f"lokal (llama.cpp): {os.path.basename(self.model_path) if self.model_path else 'kein Modell'}"


# --------------------------------------------------------------------------
# Ollama (lokaler Server)
# --------------------------------------------------------------------------
class OllamaBackend(ModelBackend):
    name = "ollama"
    is_llm = True

    def __init__(self, model: str = "qwen2.5:0.5b", base_url: str = "http://localhost:11434") -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")

    def generate(self, system_prompt: str, user_message: str) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "stream": False,
        }
        req = urllib.request.Request(
            f"{self.base_url}/api/chat",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310
                data = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise BackendError(f"Ollama unter {self.base_url} nicht erreichbar ({exc})") from exc
        return data.get("message", {}).get("content", "")

    def describe(self) -> str:
        return f"Ollama ({self.model})"

    @classmethod
    def ping(cls, base_url: str = "http://localhost:11434") -> bool:
        try:
            req = urllib.request.Request(f"{base_url.rstrip('/')}/api/tags")
            with urllib.request.urlopen(req, timeout=1.0) as resp:  # noqa: S310
                return resp.status == 200
        except Exception:
            return False


# --------------------------------------------------------------------------
# OpenAI-kompatible API
# --------------------------------------------------------------------------
class OpenAICompatBackend(ModelBackend):
    name = "openai"
    is_llm = True

    def __init__(self, model: str = "gpt-4o-mini", base_url: str = "https://api.openai.com/v1",
                 api_key: str = "") -> None:
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def generate(self, system_prompt: str, user_message: str) -> str:
        if not self.api_key:
            raise BackendError("Kein API-Key konfiguriert (Einstellungen → Modell).")
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "max_tokens": 256,
            "temperature": 0.7,
        }
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {self.api_key}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310
                data = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise BackendError(f"API nicht erreichbar: {exc}") from exc
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise BackendError(f"Unerwartete API-Antwort: {data}") from exc

    def describe(self) -> str:
        return f"OpenAI-kompatibel ({self.model})"


# --------------------------------------------------------------------------
# Factory
# --------------------------------------------------------------------------
def create_backend(config: dict[str, Any] | None = None) -> ModelBackend:
    """Erzeugt das Backend gemäß Config. 'auto' wählt das erste verfügbare."""
    cfg = config or {}
    engine = str(cfg.get("engine", "auto")).lower()

    if engine == "none":
        return DeterministicBackend()
    if engine == "llamacpp":
        return LlamaCppBackend(cfg.get("model_path") or None)
    if engine == "ollama":
        return OllamaBackend(str(cfg.get("model", "qwen2.5:0.5b")),
                             str(cfg.get("base_url", "http://localhost:11434")))
    if engine == "openai":
        return OpenAICompatBackend(str(cfg.get("model", "gpt-4o-mini")),
                                   str(cfg.get("base_url", "https://api.openai.com/v1")),
                                   str(cfg.get("api_key", "")))

    # auto: erst Ollama, dann llama.cpp, dann deterministisch
    if OllamaBackend.ping():
        return OllamaBackend(str(cfg.get("model", "qwen2.5:0.5b")),
                             str(cfg.get("base_url", "http://localhost:11434")))
    if LlamaCppBackend._find_model():
        try:
            return LlamaCppBackend()
        except Exception:
            pass
    return DeterministicBackend()
