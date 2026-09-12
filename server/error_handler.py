"""Strukturierte Fehler ohne Interna."""
from __future__ import annotations

from typing import Any


class AppError(Exception):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status

    def to_dict(self) -> dict[str, Any]:
        return {"type": "error", "code": self.code, "message": self.message}


class RbacError(AppError):
    def __init__(self, message: str = "Unzureichende Berechtigung") -> None:
        super().__init__("RBAC_DENIED", message, 403)


class NetworkError(AppError):
    def __init__(self, message: str = "Netzwerkfehler") -> None:
        super().__init__("NETWORK_ERROR", message, 502)


class DeviceError(AppError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, message, 400)


def to_user_message(exc: Exception) -> str:
    if isinstance(exc, AppError):
        return exc.message
    return "Interner Fehler"
