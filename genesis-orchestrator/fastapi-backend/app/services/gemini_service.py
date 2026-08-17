"""Gemini AI integration for context explanations.

Wraps the synchronous `google-generativeai` SDK in a thread executor so the
async event loop is never blocked by an upstream API call.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger(__name__)


class GeminiService:
    """Produces natural-language explanations for graph nodes."""

    def __init__(self, api_key: str, model: str, system_prompt: str = "") -> None:
        self._model_name = model
        self._system_prompt = system_prompt
        self._configured = bool(api_key)

        if self._configured:
            import google.generativeai as genai

            genai.configure(api_key=api_key)
            self._model = genai.GenerativeModel(model_name=model)

    @property
    def available(self) -> bool:
        return self._configured

    async def explain(self, context: dict[str, Any]) -> str:
        """Explain a node ("Erkläre diesen Switch") given its graph context."""
        if not self._configured:
            return "KI-Zusammenfassung nicht verfügbar (GEMINI_API_KEY fehlt)."

        prompt = self._build_prompt(context)
        try:
            # Offload the blocking SDK call to a worker thread.
            return await asyncio.to_thread(self._generate, prompt)
        except Exception as exc:  # noqa: BLE001 - surface a graceful fallback
            logger.exception("Gemini request failed")
            return f"KI-Zusammenfassung fehlgeschlagen: {exc}"

    def _build_prompt(self, context: dict[str, Any]) -> str:
        props = context.get("properties", {})
        relationships = context.get("relationships", [])

        lines = [
            "Erkläre diesen Switch/Knoten:",
            f"  Knoten: {props}",
            "  Verbindungen:",
        ]
        for rel in relationships:
            lines.append(
                f"    -[:{rel.get('type')}]-> {rel.get('target_id')} ({rel.get('target_label')})"
            )
        return "\n".join(lines)

    def _generate(self, prompt: str) -> str:
        contents = []
        if self._system_prompt:
            contents.append({"role": "user", "parts": [self._system_prompt]})
        contents.append({"role": "user", "parts": [prompt]})

        response = self._model.generate_content(contents)
        return (response.text or "").strip()
