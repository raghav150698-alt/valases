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
    parser = argparse.ArgumentParser(description="Backfill organization ownership for existing Valases companies.")
    parser.add_argument("--apply", action="store_true", help="Create missing organizations and owner memberships.")
    parser.add_argument("--provider-id", type=int, action="append", default=[], help="Provider/company ID to backfill. Repeat for multiple companies.")
    parser.add_argument("--all-active", action="store_true", help="Acknowledge backfilling every active provider account.")
    args = parser.parse_args()
    if args.apply and not args.provider_id and not args.all_active:
        parser.error("--apply requires at least one --provider-id or the explicit --all-active acknowledgement")

    from app.api.routes.admin import _ensure_company_organization, _organization_for_owner
    from app.db.session import SessionLocal
    from app.models.entities import ProviderProfile, User, UserRole

    with SessionLocal() as db:
        query = select(ProviderProfile, User).join(User, User.id == ProviderProfile.user_id).where(
            User.role == UserRole.PROVIDER,
            User.is_active.is_(True),
            User.account_state == "active",
        )
        if args.provider_id:
            query = query.where(ProviderProfile.id.in_(set(args.provider_id)))
        rows = db.execute(query.order_by(ProviderProfile.id.asc())).all()
        missing = [(provider, owner) for provider, owner in rows if not _organization_for_owner(db, owner)]
        result = {
            "mode": "apply" if args.apply else "preview",
            "companies_scanned": len(rows),
            "organizations_missing": len(missing),
            "organizations_created": 0,
            "companies": [{"provider_id": provider.id, "company": provider.display_name, "owner_email": owner.email} for provider, owner in missing],
        }
        if args.apply:
            for provider, owner in missing:
                _ensure_company_organization(db, provider=provider, owner=owner, actor_user_id=None)
                result["organizations_created"] += 1
            db.commit()
        print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
