from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sqlalchemy import select


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    parser = argparse.ArgumentParser(description="Preview or execute one organization's retention policy.")
    parser.add_argument("--provider-id", type=int, required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--confirm-provider-id", type=int)
    args = parser.parse_args()
    if args.execute and args.confirm_provider_id != args.provider_id:
        parser.error("--execute requires --confirm-provider-id with the same provider ID")

    from app.api.routes.admin import _organization_for_owner
    from app.db.session import SessionLocal
    from app.models.entities import ProviderProfile, User
    from app.services.organization_retention import run_organization_retention

    with SessionLocal() as db:
        provider = db.get(ProviderProfile, args.provider_id)
        owner = db.get(User, provider.user_id) if provider else None
        organization = _organization_for_owner(db, owner) if owner else None
        if not provider or not owner or not organization:
            print(json.dumps({"error": "Provider organization not found", "provider_id": args.provider_id}, indent=2))
            return 2
        result = run_organization_retention(
            db,
            organization=organization,
            owner_user_id=owner.id,
            execute=args.execute,
            actor_user_id=None,
        )
        print(json.dumps(result.to_dict(), indent=2, default=str))
        if args.execute and result.blocked_by_legal_hold:
            return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
