"""Run the Valases client-launch release gate without printing secrets."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))


def main() -> int:
    parser = argparse.ArgumentParser(description="Check Valases production launch readiness.")
    parser.add_argument(
        "--skip-database",
        action="store_true",
        help="Skip the live database connection and schema check.",
    )
    args = parser.parse_args()

    from app.services.launch_readiness import evaluate_launch_readiness

    result = evaluate_launch_readiness(check_database=not args.skip_database)
    print(json.dumps(result, indent=2))
    return 0 if result["ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
