"""Region assignment policy for future self-service provisioning.

This module is deliberately independent of HTTP and billing so the same policy
can be used by an operator workflow now and by self-service onboarding later.
"""

from __future__ import annotations

from typing import Literal

Region = Literal["tokyo", "mumbai"]

SUPPORTED_REGIONS: tuple[Region, ...] = ("tokyo", "mumbai")

# These are defaults only. A customer's contractual residency requirement has
# priority over geographic proximity and must be explicit during onboarding.
COUNTRY_DEFAULT_REGIONS: dict[str, Region] = {
    "in": "mumbai",
    "india": "mumbai",
    "jp": "tokyo",
    "japan": "tokyo",
}


def normalize_region(value: str | None) -> Region | None:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in SUPPORTED_REGIONS else None  # type: ignore[return-value]


def choose_region(
    *,
    company_country: str | None = None,
    residency_region: str | None = None,
    preferred_region: str | None = None,
    default_region: str = "tokyo",
) -> Region:
    """Choose a region using residency first, then preference, then country."""
    for candidate in (residency_region, preferred_region):
        region = normalize_region(candidate)
        if region:
            return region

    country = str(company_country or "").strip().lower()
    if country in COUNTRY_DEFAULT_REGIONS:
        return COUNTRY_DEFAULT_REGIONS[country]

    return normalize_region(default_region) or "tokyo"


def region_assignment_payload(*, region: Region, source: str = "operator") -> dict[str, object]:
    """Return the durable organization fields used by provisioning workflows."""
    return {
        "data_region": region,
        "region_assignment_source": source,
        "region_locked": True,
    }
