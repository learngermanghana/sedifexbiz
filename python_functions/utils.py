"""Shared helpers for the Python rewrite."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional

from .errors import HttpsError
from .plans import PLAN_IDS, PlanId
from .timestamp import Timestamp


VALID_ROLES = {"owner", "staff"}


@dataclass
class ContactPayload:
    phone: Optional[str]
    has_phone: bool
    first_signup_email: Optional[str]
    has_first_signup_email: bool
    owner_name: Optional[str]
    has_owner_name: bool
    business_name: Optional[str]
    has_business_name: bool
    country: Optional[str]
    has_country: bool
    town: Optional[str]
    has_town: bool
    signup_role: Optional[str]
    has_signup_role: bool


def normalize_plan_id(value: Any) -> Optional[PlanId]:
    if isinstance(value, str):
        candidate = value.strip().lower()
        if candidate and candidate in PLAN_IDS:
            return candidate
    return None


def normalize_workspace_slug(value: Any, fallback: str) -> str:
    if isinstance(value, str):
        candidate = value.strip()
        if candidate:
            return candidate
    return fallback


def to_timestamp(value: Any) -> Optional[Timestamp]:
    if isinstance(value, Timestamp):
        return value
    if isinstance(value, Mapping):
        millis = value.get("_millis")
        if isinstance(millis, (int, float)):
            return Timestamp.from_millis(int(millis))
        to_millis = value.get("toMillis")
        if callable(to_millis):
            millis_value = int(to_millis())
            return Timestamp.from_millis(millis_value)
    return None


def get_optional_string(value: Any) -> Optional[str]:
    if isinstance(value, str):
        candidate = value.strip()
        return candidate or None
    return None


def get_optional_email(value: Any) -> Optional[str]:
    candidate = get_optional_string(value)
    return candidate.lower() if candidate else None


def is_inactive_contract_status(value: Optional[str]) -> bool:
    if not value:
        return False
    tokens = {token for token in value.lower().replace("_", "-").split("-") if token}
    inactive = {
        "inactive",
        "terminated",
        "termination",
        "cancelled",
        "canceled",
        "suspended",
        "paused",
        "hold",
        "closed",
        "ended",
        "deactivated",
        "disabled",
    }
    return any(token in tokens for token in inactive)


def normalize_contact_payload(raw: Any) -> ContactPayload:
    phone = None
    has_phone = False
    first_signup_email = None
    has_first_signup_email = False
    owner_name = None
    has_owner_name = False
    business_name = None
    has_business_name = False
    country = None
    has_country = False
    town = None
    has_town = False
    signup_role = None
    has_signup_role = False

    if isinstance(raw, Mapping):
        if "phone" in raw:
            has_phone = True
            phone = _normalize_nullable_string(raw["phone"], "Phone must be a string when provided")
        if "firstSignupEmail" in raw:
            has_first_signup_email = True
            first_signup_email = _normalize_nullable_email(
                raw["firstSignupEmail"],
                "First signup email must be a string when provided",
            )
        if "ownerName" in raw:
            has_owner_name = True
            owner_name = _normalize_nullable_string(raw["ownerName"], "Owner name must be a string when provided")
        if "businessName" in raw:
            has_business_name = True
            business_name = _normalize_nullable_string(raw["businessName"], "Business name must be a string when provided")
        if "country" in raw:
            has_country = True
            country = _normalize_nullable_string(raw["country"], "Country must be a string when provided")
        if "town" in raw:
            has_town = True
            town = _normalize_nullable_string(raw["town"], "Town must be a string when provided")
        if "signupRole" in raw:
            has_signup_role = True
            signup_role = _normalize_signup_role(raw["signupRole"])

    return ContactPayload(
        phone=phone,
        has_phone=has_phone,
        first_signup_email=first_signup_email,
        has_first_signup_email=has_first_signup_email,
        owner_name=owner_name,
        has_owner_name=has_owner_name,
        business_name=business_name,
        has_business_name=has_business_name,
        country=country,
        has_country=has_country,
        town=town,
        has_town=has_town,
        signup_role=signup_role,
        has_signup_role=has_signup_role,
    )


def _normalize_nullable_string(value: Any, message: str) -> Optional[str]:
    if value in (None, ""):
        return None
    if isinstance(value, str):
        candidate = value.strip()
        return candidate or None
    raise HttpsError("invalid-argument", message)


def _normalize_nullable_email(value: Any, message: str) -> Optional[str]:
    result = _normalize_nullable_string(value, message)
    return result.lower() if result else None


def _normalize_signup_role(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise HttpsError("invalid-argument", "Signup role must be a string when provided")
    normalized = value.strip().lower().replace("_", "-").replace(" ", "-")
    if normalized == "owner":
        return "owner"
    if normalized in {"team-member", "team"}:
        return "team-member"
    return None


def serialize_firestore_data(data: Mapping[str, Any]) -> Dict[str, Any]:
    serialised: Dict[str, Any] = {}
    for key, value in data.items():
        if isinstance(value, Timestamp):
            serialised[key] = {"_millis": value.to_millis()}
        elif isinstance(value, Mapping):
            serialised[key] = serialize_firestore_data(value)
        else:
            serialised[key] = value
    return serialised


def to_seed_records(value: Any) -> List[Mapping[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, Mapping)]
    if isinstance(value, Mapping):
        return [item for item in value.values() if isinstance(item, Mapping)]
    return []
