"""Core callable implementations translated to Python."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Mapping, MutableMapping, Optional

from .auth import AuthError, InMemoryAuth
from .constants import INACTIVE_WORKSPACE_MESSAGE
from .context import CallableContext
from .datastore import InMemoryFirestore
from .errors import HttpsError
from .plans import get_billing_config
from .timestamp import Timestamp, server_timestamp
from .utils import (
    VALID_ROLES,
    get_optional_email,
    get_optional_string,
    is_inactive_contract_status,
    normalize_contact_payload,
    normalize_plan_id,
    normalize_workspace_slug,
    serialize_firestore_data,
    to_timestamp,
)

DEFAULT_ROSTER_DB = InMemoryFirestore()
DEFAULT_DEFAULT_DB = InMemoryFirestore()
DEFAULT_AUTH = InMemoryAuth()


@dataclass
class CallableDependencies:
    roster_db: InMemoryFirestore = DEFAULT_ROSTER_DB
    default_db: InMemoryFirestore = DEFAULT_DEFAULT_DB
    auth: InMemoryAuth = DEFAULT_AUTH


def initialize_store(
    data: Optional[Mapping[str, Any]],
    context: CallableContext,
    deps: CallableDependencies = CallableDependencies(),
) -> Mapping[str, Any]:
    assert_authenticated(context)

    uid = context.auth.uid  # type: ignore[union-attr]
    token = context.auth.token  # type: ignore[union-attr]

    email = token.get("email") if isinstance(token, Mapping) else None
    email_value = email if isinstance(email, str) else None
    normalized_email = email_value.lower() if email_value else None
    token_phone = token.get("phone_number") if isinstance(token, Mapping) else None
    token_phone = token_phone if isinstance(token_phone, str) else None

    payload = dict(data or {})
    contact = normalize_contact_payload(payload.get("contact"))

    resolved_phone = contact.phone if contact.has_phone else token_phone
    resolved_first_signup_email = (
        contact.first_signup_email if contact.has_first_signup_email else (normalized_email or None)
    )
    resolved_owner_name = contact.owner_name if contact.has_owner_name else None
    resolved_business_name = contact.business_name if contact.has_business_name else None
    resolved_country = contact.country if contact.has_country else None
    resolved_town = contact.town if contact.has_town else None
    resolved_signup_role = contact.signup_role if contact.has_signup_role else None

    roster_db = deps.roster_db
    default_db = deps.default_db

    member_ref = roster_db.collection("teamMembers").doc(uid)
    default_member_ref = default_db.collection("teamMembers").doc(uid)
    member_snap = member_ref.get()
    default_member_snap = default_member_ref.get()

    timestamp = server_timestamp()

    billing_config = get_billing_config()
    trial_days = int(billing_config.get("trial_days", 14))

    requested_plan_id = normalize_plan_id(payload.get("planId"))
    if payload.get("planId") is not None and requested_plan_id is None:
        raise HttpsError("invalid-argument", "Choose a valid Sedifex plan.")

    existing_member = member_snap.data()
    existing_store_id = get_optional_string(existing_member.get("storeId")) if existing_member else None
    store_id = existing_store_id or uid

    store_ref = default_db.collection("stores").doc(store_id)
    store_snap = store_ref.get()
    existing_store = store_snap.data()

    workspace_slug = normalize_workspace_slug(
        get_optional_string(existing_store.get("workspaceSlug"))
        or get_optional_string(existing_store.get("slug"))
        or get_optional_string(existing_store.get("storeSlug"))
        or None,
        store_id,
    )

    workspace_ref = default_db.collection("workspaces").doc(workspace_slug)
    workspace_snap = workspace_ref.get()
    existing_workspace = workspace_snap.data()

    existing_billing = existing_store.get("billing") if existing_store else None
    billing_payload = dict(existing_billing or {})

    existing_plan_id = normalize_plan_id(billing_payload.get("planId") if billing_payload else None)
    if not existing_plan_id:
        existing_plan_id = normalize_plan_id(existing_store.get("planId")) if existing_store else None
    resolved_plan_id = requested_plan_id or existing_plan_id or "starter"

    trial_duration_ms = max(trial_days, 0) * 24 * 60 * 60 * 1000
    now = Timestamp.now()
    existing_contract_start = to_timestamp(existing_store.get("contractStart")) if existing_store else None
    contract_start = existing_contract_start or now
    existing_contract_end = to_timestamp(existing_store.get("contractEnd")) if existing_store else None
    contract_end = existing_contract_end or Timestamp.from_millis(contract_start.to_millis() + trial_duration_ms)

    member_data: MutableMapping[str, Any] = {
        "uid": uid,
        "email": email_value,
        "role": "owner",
        "storeId": store_id,
        "phone": resolved_phone,
        "firstSignupEmail": resolved_first_signup_email,
        "invitedBy": uid,
        "updatedAt": timestamp,
        "workspaceSlug": workspace_slug,
    }

    _apply_optional_member_fields(
        member_data,
        resolved_owner_name,
        resolved_business_name,
        resolved_country,
        resolved_town,
        resolved_signup_role,
    )

    if not member_snap.exists:
        member_data["createdAt"] = timestamp
    member_ref.set(member_data, merge=True)

    default_member_data = dict(member_data)
    if not default_member_snap.exists:
        default_member_data["createdAt"] = timestamp
    default_member_ref.set(default_member_data, merge=True)

    if normalized_email:
        email_ref = roster_db.collection("teamMembers").doc(normalized_email)
        email_snap = email_ref.get()
        email_data = dict(member_data)
        email_data["email"] = email_value
        if not email_snap.exists:
            email_data["createdAt"] = timestamp
        email_ref.set(email_data, merge=True)

    store_data: MutableMapping[str, Any] = {
        "ownerId": uid,
        "updatedAt": timestamp,
        "workspaceSlug": workspace_slug,
        "billing": dict(billing_payload),
    }

    if "status" not in store_data:
        store_data["status"] = get_optional_string(existing_store.get("status")) or "Active"
    if "contractStatus" not in store_data:
        store_data["contractStatus"] = get_optional_string(existing_store.get("contractStatus")) or "Active"
    store_data.setdefault("inventorySummary", existing_store.get("inventorySummary") or {
        "trackedSkus": 0,
        "lowStockSkus": 0,
        "incomingShipments": 0,
    })

    if email_value:
        store_data["ownerEmail"] = email_value
    if resolved_owner_name:
        store_data["ownerName"] = resolved_owner_name
    if resolved_business_name:
        store_data["displayName"] = resolved_business_name
        store_data["businessName"] = resolved_business_name
    if resolved_country:
        store_data["country"] = resolved_country
    if resolved_town:
        store_data["town"] = resolved_town
    if resolved_phone:
        store_data["ownerPhone"] = resolved_phone

    billing_details = dict(billing_payload)
    billing_details["planId"] = resolved_plan_id
    billing_details.setdefault("provider", "paystack")
    billing_details.setdefault("status", "trial")
    if "trialEndsAt" not in billing_details:
        billing_details["trialEndsAt"] = contract_end
    store_data["billing"] = billing_details

    if not store_snap.exists:
        store_data["createdAt"] = timestamp

    if "contractStart" not in store_data:
        store_data["contractStart"] = contract_start
    if "contractEnd" not in store_data:
        store_data["contractEnd"] = contract_end

    store_ref.set(store_data, merge=True)

    workspace_data: MutableMapping[str, Any] = {
        "slug": workspace_slug,
        "storeId": store_id,
        "ownerId": uid,
        "updatedAt": timestamp,
        "planId": resolved_plan_id,
    }

    if not workspace_snap.exists:
        workspace_data["createdAt"] = timestamp

    _apply_optional_workspace_fields(
        workspace_data,
        email_value,
        resolved_phone,
        resolved_owner_name,
        resolved_business_name,
        resolved_country,
        resolved_town,
        resolved_first_signup_email,
    )

    if "contractStart" not in workspace_data:
        workspace_data["contractStart"] = contract_start
    if "contractEnd" not in workspace_data:
        workspace_data["contractEnd"] = contract_end
    workspace_data.setdefault("status", get_optional_string(existing_workspace.get("status")) or "active")
    workspace_data.setdefault(
        "contractStatus",
        get_optional_string(existing_workspace.get("contractStatus")) or "active",
    )
    workspace_data.setdefault("paymentStatus", get_optional_string(existing_workspace.get("paymentStatus")) or "trial")

    workspace_ref.set(workspace_data, merge=True)

    claims = update_user_claims(uid, "owner", deps.auth)

    return {
        "ok": True,
        "storeId": store_id,
        "claims": claims,
        "teamMember": {"id": member_ref.id, "data": serialize_firestore_data(member_data)},
        "store": {"id": store_ref.id, "data": serialize_firestore_data(store_data)},
        "workspace": {"id": workspace_ref.id, "data": serialize_firestore_data(workspace_data)},
    }


def resolve_store_access(
    data: Optional[Mapping[str, Any]],
    context: CallableContext,
    deps: CallableDependencies = CallableDependencies(),
) -> Mapping[str, Any]:
    assert_authenticated(context)

    uid = context.auth.uid  # type: ignore[union-attr]
    roster_db = deps.roster_db
    default_db = deps.default_db

    member_ref = roster_db.collection("teamMembers").doc(uid)
    member_snap = member_ref.get()
    member_data = member_snap.data()

    if not member_snap.exists:
        raise HttpsError(
            "permission-denied",
            "We could not find a workspace assignment for this account. Reach out to your Sedifex administrator.",
        )

    store_id = get_optional_string(member_data.get("storeId")) or uid
    workspace_slug = get_optional_string(member_data.get("workspaceSlug")) or store_id

    store_ref = default_db.collection("stores").doc(store_id)
    store_snap = store_ref.get()
    store_data = store_snap.data()

    if not store_snap.exists:
        raise HttpsError(
            "failed-precondition",
            "We could not locate the Sedifex workspace configuration for this store. Reach out to your Sedifex administrator.",
        )

    store_status = get_optional_string(store_data.get("status")) or store_data.get("contractStatus")
    if is_inactive_contract_status(store_status if isinstance(store_status, str) else None):
        raise HttpsError("permission-denied", INACTIVE_WORKSPACE_MESSAGE)

    claims = update_user_claims(uid, member_data.get("role", "staff"), deps.auth)

    return {
        "ok": True,
        "storeId": store_id,
        "workspaceSlug": workspace_slug,
        "claims": claims,
        "teamMember": {"id": member_ref.id, "data": serialize_firestore_data(member_data)},
        "store": {"id": store_ref.id, "data": serialize_firestore_data(store_data)},
    }


def manage_staff_account(
    data: Optional[Mapping[str, Any]],
    context: CallableContext,
    deps: CallableDependencies = CallableDependencies(),
) -> Mapping[str, Any]:
    assert_owner_access(context)

    payload = data or {}
    store_id, email, role, password = normalize_manage_staff_payload(payload)
    invited_by = context.auth.uid if context.auth else None

    try:
        record, created = deps.auth.ensure_user(email, password)
    except AuthError as error:
        raise HttpsError("internal", error.message) from error

    member_ref = deps.roster_db.collection("teamMembers").doc(record.uid)
    member_snap = member_ref.get()
    timestamp = server_timestamp()

    member_data: MutableMapping[str, Any] = {
        "uid": record.uid,
        "email": email,
        "storeId": store_id,
        "role": role,
        "invitedBy": invited_by,
        "updatedAt": timestamp,
    }

    if not member_snap.exists:
        member_data["createdAt"] = timestamp
    member_ref.set(member_data, merge=True)

    email_ref = deps.roster_db.collection("teamMembers").doc(email)
    email_snap = email_ref.get()
    email_data = dict(member_data)
    email_data["email"] = email
    if not email_snap.exists:
        email_data["createdAt"] = timestamp
    email_ref.set(email_data, merge=True)

    claims = update_user_claims(record.uid, role, deps.auth)

    return {
        "ok": True,
        "role": role,
        "email": email,
        "uid": record.uid,
        "created": created,
        "storeId": store_id,
        "claims": claims,
    }


def assert_authenticated(context: CallableContext) -> None:
    if context.auth is None:
        raise HttpsError("unauthenticated", "Login required")


def assert_owner_access(context: CallableContext) -> None:
    assert_authenticated(context)
    role = get_role_from_token(context.auth.token)
    if role != "owner":
        raise HttpsError("permission-denied", "Owner access required")


def assert_staff_access(context: CallableContext) -> None:
    assert_authenticated(context)
    role = get_role_from_token(context.auth.token)
    if not role:
        raise HttpsError("permission-denied", "Staff access required")


def get_role_from_token(token: Mapping[str, Any]) -> Optional[str]:
    role = token.get("role") if isinstance(token, Mapping) else None
    if isinstance(role, str) and role.lower() in VALID_ROLES:
        return role.lower()
    return None


def update_user_claims(uid: str, role: str, auth: InMemoryAuth) -> Mapping[str, Any]:
    record = auth.ensure_uid(uid)
    claims = dict(record.custom_claims)
    claims["role"] = role
    for key in ["stores", "activeStoreId", "storeId", "roleByStore"]:
        claims.pop(key, None)
    auth.set_custom_user_claims(uid, claims)
    return claims


def normalize_manage_staff_payload(data: Mapping[str, Any]) -> tuple[str, str, str, Optional[str]]:
    store_id = get_optional_string(data.get("storeId")) or ""
    email = get_optional_email(data.get("email")) or ""
    role = get_optional_string(data.get("role")) or ""
    password_raw = data.get("password")

    password: Optional[str]
    if password_raw in (None, ""):
        password = None
    elif isinstance(password_raw, str):
        password = password_raw
    else:
        raise HttpsError("invalid-argument", "Password must be a string when provided")

    if not store_id:
        raise HttpsError("invalid-argument", "A storeId is required")
    if not email:
        raise HttpsError("invalid-argument", "A valid email is required")
    if not role:
        raise HttpsError("invalid-argument", "A role is required")
    if role not in VALID_ROLES:
        raise HttpsError("invalid-argument", "Unsupported role requested")

    return store_id, email, role, password


def _apply_optional_member_fields(
    member_data: MutableMapping[str, Any],
    owner_name: Optional[str],
    business_name: Optional[str],
    country: Optional[str],
    town: Optional[str],
    signup_role: Optional[str],
) -> None:
    if owner_name is not None:
        member_data["name"] = owner_name
    if business_name is not None:
        member_data["companyName"] = business_name
    if country is not None:
        member_data["country"] = country
    if town is not None:
        member_data["town"] = town
    if signup_role is not None:
        member_data["signupRole"] = signup_role


def _apply_optional_workspace_fields(
    workspace_data: MutableMapping[str, Any],
    email: Optional[str],
    phone: Optional[str],
    owner_name: Optional[str],
    business_name: Optional[str],
    country: Optional[str],
    town: Optional[str],
    first_signup_email: Optional[str],
) -> None:
    if email:
        workspace_data["ownerEmail"] = email
    if phone:
        workspace_data["ownerPhone"] = phone
    if owner_name:
        workspace_data["ownerName"] = owner_name
    if business_name:
        workspace_data["company"] = business_name
        workspace_data["displayName"] = business_name
    if country:
        workspace_data["country"] = country
    if town:
        workspace_data["town"] = town
    if first_signup_email is not None:
        workspace_data["firstSignupEmail"] = first_signup_email
