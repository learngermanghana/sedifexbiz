"""Context utilities used by callable rewrites."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Optional


@dataclass
class AuthContext:
    """Represents the authenticated caller details."""

    uid: str
    token: Mapping[str, object]


@dataclass
class CallableContext:
    """Simplified callable context for the Python implementation."""

    auth: Optional[AuthContext] = None
