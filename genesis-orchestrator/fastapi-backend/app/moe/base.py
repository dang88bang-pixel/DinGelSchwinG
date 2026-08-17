"""Base contract every dynamically loadable controller parser must implement."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ParsedFrame:
    """A single decoded telemetry frame produced by a controller parser."""

    protocol: str
    fields: dict[str, Any] = field(default_factory=dict)


class ControllerParser(ABC):
    """Abstract base for protocol/controller parsers.

    A parser decodes raw byte frames (UART/BLE/CAN) from a specific
    e-mobility controller into key/value telemetry. Dynamically loaded parsers
    (shipped as a zip of a Python package) must subclass this and expose the
    class as the module attribute ``PARSER_CLASS``.
    """

    #: Protocol identifier, e.g. "vesc", "ninebot_uart".
    protocol: str = "base"
    version: str = "0.0.0"

    @abstractmethod
    async def parse_frame(self, raw: bytes) -> ParsedFrame | None:
        """Decode one raw frame.

        Returns ``None`` when the frame is not valid / not of interest.
        """

    async def close(self) -> None:
        """Optional cleanup (closing serial/BLE handles, etc.)."""
        return None
