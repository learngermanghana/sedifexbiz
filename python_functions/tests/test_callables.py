from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from python_functions import (  # noqa: E402
    AuthContext,
    CallableContext,
    CallableDependencies,
    InMemoryAuth,
    InMemoryFirestore,
    initialize_store,
    manage_staff_account,
    resolve_store_access,
)


def build_deps() -> CallableDependencies:
    roster = InMemoryFirestore()
    default = InMemoryFirestore()
    auth = InMemoryAuth()
    return CallableDependencies(roster_db=roster, default_db=default, auth=auth)


def test_initialize_store_bootstraps_workspace():
    deps = build_deps()
    context = CallableContext(auth=AuthContext(uid="user_1", token={"email": "owner@example.com"}))

    response = initialize_store({}, context, deps)

    assert response["ok"] is True
    assert response["storeId"] == "user_1"
    assert response["claims"]["role"] == "owner"
    store_data = response["store"]["data"]
    assert store_data["ownerEmail"] == "owner@example.com"
    workspace_data = response["workspace"]["data"]
    assert workspace_data["planId"] == "starter"


def test_manage_staff_account_creates_staff_account():
    deps = build_deps()
    owner_context = CallableContext(auth=AuthContext(uid="owner", token={"role": "owner"}))

    response = manage_staff_account(
        {"storeId": "store_1", "email": "staff@example.com", "role": "staff", "password": "pass"},
        owner_context,
        deps,
    )

    assert response["ok"] is True
    assert response["role"] == "staff"
    assert response["claims"]["role"] == "staff"


def test_resolve_store_access_returns_store_details():
    deps = build_deps()
    context = CallableContext(auth=AuthContext(uid="user_2", token={"email": "owner@example.com"}))
    initialize_store({}, context, deps)

    response = resolve_store_access({}, context, deps)

    assert response["ok"] is True
    assert response["storeId"] == "user_2"
    assert response["claims"]["role"] == "owner"
