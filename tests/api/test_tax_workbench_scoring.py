import unittest
from types import SimpleNamespace

from app.api.routes.exams import _evaluate_checkpoints
from app.services.default_assessments import get_default_assessment


class TaxWorkbenchScoringTest(unittest.TestCase):
    def setUp(self) -> None:
        definition = get_default_assessment("individual-tax-review")
        self.assertIsNotNone(definition)
        task = (definition or {})["task"]
        self.task = SimpleNamespace(grading_config_json=task["grading_config"], marks=task["marks"])

    def _complete_submission(self) -> dict:
        return {
            "entered_form_values": {
                "wages": 118_000,
                "federal_withholding": 24_500,
                "taxable_interest": 2_400,
                "business_receipts": 46_000,
                "allowable_business_expenses": 18_500,
                "hsa_deduction": 3_850,
                "standard_deduction": 23_625,
                "pre_credit_tax": 20_010,
                "nonrefundable_credits": 2_000,
                "schedule_c_profit": 27_500,
                "adjusted_gross_income": 144_050,
                "taxable_income": 120_425,
                "tax_after_credits": 18_010,
                "refund": 6_490,
            },
            "identified_red_flags": [
                "Vehicle expense lacks mileage log",
                "Dependent SSN missing",
                "1099-NEC source document missing",
            ],
        }

    def test_complete_tax_return_scores_all_checkpoints(self) -> None:
        result = _evaluate_checkpoints(self.task, self._complete_submission())

        self.assertIsNotNone(result)
        score, detail = result or (None, {})
        self.assertEqual(score, 100.0)
        self.assertTrue(all(item["matched"] for item in detail["checkpoints"]))

    def test_unsupported_expense_reduces_schedule_c_and_return_score(self) -> None:
        submission = self._complete_submission()
        submission["entered_form_values"]["allowable_business_expenses"] = 24_700
        submission["entered_form_values"]["schedule_c_profit"] = 21_300
        submission["entered_form_values"]["adjusted_gross_income"] = 137_850
        submission["entered_form_values"]["taxable_income"] = 114_225

        result = _evaluate_checkpoints(self.task, submission)

        self.assertIsNotNone(result)
        score, detail = result or (None, {})
        self.assertEqual(score, 58.0)
        failed = {item["id"] for item in detail["checkpoints"] if not item["matched"]}
        self.assertEqual(failed, {"expenses", "schedule-c", "agi", "taxable"})

    def test_false_positive_diagnostic_fails_exact_exception_checkpoint(self) -> None:
        submission = self._complete_submission()
        submission["identified_red_flags"].append("Standard deduction is unavailable")

        result = _evaluate_checkpoints(self.task, submission)

        self.assertIsNotNone(result)
        score, detail = result or (None, {})
        self.assertEqual(score, 91.0)
        flag_checkpoint = next(item for item in detail["checkpoints"] if item["id"] == "flags")
        self.assertFalse(flag_checkpoint["matched"])


if __name__ == "__main__":
    unittest.main()
