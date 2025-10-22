"""Timestamp helpers that roughly emulate Firestore timestamps."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class Timestamp:
    """Timezone-aware UTC timestamp."""

    value: datetime

    @classmethod
    def now(cls) -> "Timestamp":
        return cls(datetime.now(tz=timezone.utc))

    @classmethod
    def from_millis(cls, millis: int) -> "Timestamp":
        seconds, micro = divmod(int(millis), 1000)
        return cls(datetime.fromtimestamp(seconds, tz=timezone.utc).replace(microsecond=micro * 1000))

    def to_millis(self) -> int:
        epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
        delta = self.value - epoch
        return int(delta.total_seconds() * 1000)

    def isoformat(self) -> str:  # pragma: no cover - formatting helper
        return self.value.isoformat()


def server_timestamp() -> Timestamp:
    """Return a timestamp representing "now" on the server."""

    return Timestamp.now()
