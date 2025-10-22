"""Python representation of Sedifex billing plans."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, Mapping, Tuple


PlanId = str
PLAN_IDS: Tuple[PlanId, ...] = ("starter", "pro", "enterprise")


@dataclass(frozen=True)
class PlanCatalogEntry:
    id: PlanId
    name: str
    monthly_ghs: int
    billing_features: Tuple[str, ...]
    marketing: Mapping[str, object]


PLAN_CATALOG: Dict[PlanId, PlanCatalogEntry] = {
    "starter": PlanCatalogEntry(
        id="starter",
        name="Starter",
        monthly_ghs=99,
        billing_features=("Up to 1,000 SKUs", "Single location", "Email support"),
        marketing={
            "badge": "Best for single stores",
            "description": "Kick off with a lightweight workspace for owner-operators.",
            "features": (
                "Up to 1,000 SKUs",
                "Single location",
                "Owner access + 2 staff accounts",
                "Core inventory workflows",
            ),
        },
    ),
    "pro": PlanCatalogEntry(
        id="pro",
        name="Pro",
        monthly_ghs=249,
        billing_features=(
            "Up to 10,000 SKUs",
            "Multi-location",
            "Priority email + chat support",
        ),
        marketing={
            "badge": "Most popular",
            "highlight": True,
            "description": "Grow into multi-store ops with team workflows and support.",
            "features": (
                "Up to 10,000 SKUs",
                "Multi-location",
                "10 staff accounts included",
                "Priority support",
            ),
        },
    ),
    "enterprise": PlanCatalogEntry(
        id="enterprise",
        name="Enterprise",
        monthly_ghs=499,
        billing_features=(
            "Unlimited SKUs",
            "Multi-location + advanced roles",
            "Dedicated success manager",
        ),
        marketing={
            "description": "Scale a nationwide fleet with advanced controls and limits.",
            "features": (
                "Unlimited SKUs",
                "Unlimited stores & users",
                "Advanced roles & approvals",
                "Dedicated success manager",
            ),
        },
    ),
}


def plan_list() -> Iterable[PlanCatalogEntry]:
    return PLAN_CATALOG.values()


def get_billing_config() -> Mapping[str, object]:
    return {
        "trial_days": 14,
        "plan_codes": {
            "starter": "",
            "pro": "",
            "enterprise": "",
        },
    }
