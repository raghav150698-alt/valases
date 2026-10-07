"""Keep the demo's practical assessments aligned with the platform catalog."""
import json
from pathlib import Path

from app.services.default_assessments import TEMPLATE_CATALOG_VERSION, list_default_assessments


def main() -> None:
    kinds = {"spreadsheet", "coding", "accounting", "tax_simulator", "tax_1120"}
    definitions = [row for row in list_default_assessments() if row["assessment_type"] in kinds]
    payload = {"catalog_version": TEMPLATE_CATALOG_VERSION, "assessments": definitions}
    target = Path(__file__).resolve().parents[1] / "app/web_assessment_react/src/dev/toolAssessmentFixtures.json"
    target.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Updated {len(definitions)} practical assessment fixtures.")


if __name__ == "__main__":
    main()
