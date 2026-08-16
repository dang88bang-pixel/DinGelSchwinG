"""In-memory registry of active controller parsers (the "experts")."""
from __future__ import annotations

import logging

from .base import ControllerParser

logger = logging.getLogger(__name__)


class ParserRegistry:
    """Holds the currently available parsers, keyed by protocol name."""

    def __init__(self) -> None:
        self._parsers: dict[str, ControllerParser] = {}

    def register(self, parser: ControllerParser) -> None:
        self._parsers[parser.protocol] = parser
        logger.info("Registered parser '%s' v%s", parser.protocol, parser.version)

    def unregister(self, protocol: str) -> None:
        self._parsers.pop(protocol, None)

    def get(self, protocol: str) -> ControllerParser | None:
        return self._parsers.get(protocol)

    def protocols(self) -> list[str]:
        return sorted(self._parsers)

    def list(self) -> list[dict[str, str]]:
        return [
            {"protocol": p.protocol, "version": p.version}
            for p in self._parsers.values()
        ]


# Process-wide singleton; dynamic loader and app both reference this.
registry = ParserRegistry()
