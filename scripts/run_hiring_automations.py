"""Run the hiring reminder sweep once.

Production deployments should run this from a separate, restartable worker or
managed scheduler. The sweep is safe to repeat because delivery keys are
persisted with a unique constraint.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.api.routes.hiring import run_hiring_automations
from app.db.session import SessionLocal
from app.models.entities import Organization, User, UserRole


def main() -> int:
    db = SessionLocal()
    try:
        system_user = db.scalar(select(User).where(User.role == UserRole.ADMIN).order_by(User.id.asc()))
        if not system_user:
            print("Hiring automation worker requires an active admin service user.", file=sys.stderr)
            return 2
        organizations = list(db.scalars(select(Organization).where(Organization.status == "active").order_by(Organization.id.asc())).all())
        total = {"organizations": 0, "sent": 0, "failed": 0, "skipped": 0}
        for organization in organizations:
            try:
                result = run_hiring_automations(organization_id=organization.id, db=db, current_user=system_user)
                total["organizations"] += 1
                for key in ("sent", "failed", "skipped"):
                    total[key] += int(result.get(key) or 0)
            except Exception as exc:
                db.rollback()
                print(f"Hiring automation failed for organization {organization.id}: {exc}", file=sys.stderr)
                total["failed"] += 1
        print(total)
        return 0 if total["failed"] == 0 else 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
