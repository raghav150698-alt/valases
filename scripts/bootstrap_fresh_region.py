"""Create the complete Valases schema in a brand-new regional database.

This is intentionally a local, operator-run command. Production serverless
startup never creates tables. Use it only once for an empty Supabase project.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap a fresh Valases regional database.")
    parser.add_argument("--confirm-fresh-region", choices=("mumbai", "tokyo"), required=True)
    args = parser.parse_args()

    database_url = os.getenv("DATABASE_URL", "").strip()
    deployment_region = os.getenv("DEPLOYMENT_REGION", "").strip().lower()
    if not database_url.startswith(("postgres://", "postgresql://", "postgresql+psycopg://")):
        raise SystemExit("DATABASE_URL must be set to the new region's PostgreSQL connection string.")
    if deployment_region != args.confirm_fresh_region:
        raise SystemExit("DEPLOYMENT_REGION must match --confirm-fresh-region.")

    # Imports occur after guards so the operator cannot accidentally use the
    # local SQLite default simply by running this command without configuration.
    from sqlalchemy import inspect
    from app.db.init_db import init_db
    from app.db.session import engine

    existing_tables = set(inspect(engine).get_table_names())
    if existing_tables:
        print("Refusing to bootstrap because this database already contains tables:")
        print(", ".join(sorted(existing_tables)[:20]))
        return 2

    init_db()
    print(f"Valases {deployment_region} schema and default assessments created successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
