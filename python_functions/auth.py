"""Simplified authentication primitives for the Python rewrite."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Mapping, Optional


class AuthError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class UserRecord:
    uid: str
    email: Optional[str] = None
    password: Optional[str] = None
    custom_claims: Dict[str, object] = field(default_factory=dict)


class InMemoryAuth:
    """A minimal auth provider that mimics Firebase Admin functions."""

    def __init__(self) -> None:
        self._users: Dict[str, UserRecord] = {}

    def get_user(self, uid: str) -> UserRecord:
        try:
            return self._users[uid]
        except KeyError as exc:  # pragma: no cover - simple branch
            raise AuthError("auth/user-not-found", f"User {uid} not found") from exc

    def get_user_by_email(self, email: str) -> UserRecord:
        lowered = email.lower()
        for record in self._users.values():
            if record.email and record.email.lower() == lowered:
                return record
        raise AuthError("auth/user-not-found", f"User with email {email} not found")

    def ensure_uid(self, uid: str, email: Optional[str] = None) -> UserRecord:
        record = self._users.get(uid)
        if record is None:
            record = UserRecord(uid=uid, email=email)
            self._users[uid] = record
        return record

    def create_user(self, *, email: str, password: str, email_verified: bool = False) -> UserRecord:
        uid = f"uid_{len(self._users) + 1}"
        record = UserRecord(uid=uid, email=email, password=password)
        self._users[uid] = record
        return record

    def update_user(self, uid: str, *, password: Optional[str] = None) -> None:
        record = self.get_user(uid)
        if password is not None:
            record.password = password

    def set_custom_user_claims(self, uid: str, claims: Mapping[str, object]) -> None:
        record = self.get_user(uid)
        record.custom_claims = dict(claims)

    def ensure_user(self, email: str, password: Optional[str]) -> tuple[UserRecord, bool]:
        try:
            record = self.get_user_by_email(email)
            if password:
                self.update_user(record.uid, password=password)
            return record, False
        except AuthError as error:
            if error.code != "auth/user-not-found":
                raise
            if not password:
                raise
            record = self.create_user(email=email, password=password, email_verified=False)
            return record, True
