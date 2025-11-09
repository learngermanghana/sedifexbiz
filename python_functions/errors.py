"""Error types mirroring Firebase callable errors."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Optional


@dataclass
class HttpsError(Exception):
    """Represents an error raised from an HTTPS callable."""

    code: str
    message: str
    details: Optional[Any] = None

    def __str__(self) -> str:  # pragma: no cover - simple repr
        base = f"[{self.code}] {self.message}"
        if self.details is None:
            return base
        return f"{base} (details={self.details!r})"


def serialize_error(error: Exception) -> Mapping[str, Any]:
    """Return a serialisable structure for logging."""

    if isinstance(error, HttpsError):
        return {"code": error.code, "message": error.message, "details": error.details}
    return {"type": type(error).__name__, "message": str(error)}
