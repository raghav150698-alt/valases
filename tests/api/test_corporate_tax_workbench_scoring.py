import unittest
from types import SimpleNamespace

from app.api.routes.exams import _evaluate_checkpoints
from app.services.default_assessments import get_default_assessment


class CorporateTaxWorkbenchScoringTest(unittest.TestCase):
    def setUp(self) -> None:
        definition = get_default_assessment("corporate-tax-1120-review")
        self.assertIsNotNone(definition)
        task = (definition or {})["task"]
        self.task = SimpleNamespace(grading_config_json=task["grading_config"], marks=task["marks"])

    def _complete_submission(self) -> dict:
        return {
            "entered_form_values": {
                "gross_receipts": 2_980_000,
                "returns_allowances": 45_000,
                "cost_of_goods_sold": 1_065_000,
                "net_sales": 2_935_000,
                "gross_profit": 1_870_000,
                "taxable_interest": 18_500,
                "capital_gain": 42_000,
                "other_income": 12_000,
                "total_income": 1_942_500,
                "allowable_bad_debts": 16_000,
                "allowable_taxes": 72_000,
                "tax_depreciation": 118_000,
                "allowable_charitable_contribution": 52_300,
                "other_deductions": 153_000,
                "total_deductions": 1_471_800,
                "taxable_income": 470_700,
                "income_tax": 98_847,
                "estimated_payments": 90_000,
                "amount_owed": 8_847,
                "book_net_income": 318_500,
                "m1_additions": 178_200,
                "m1_deductions": 26_000,
                "m1_taxable_income": 470_700,
            },
            "identified_red_flags": [
                "Federal income tax provision is nondeductible",
                "Meals require a 50% limitation",
                "Fines and penalties are nondeductible",
                "Bad-debt allowance requires a tax adjustment",
                "Charitable contribution exceeds the current-year limit",
                "Tax depreciation exceeds book depreciation",
                "Contractor information-return support is incomplete",
            ],
        }

    def test_complete_form_1120_scores_all_checkpoints(self) -> None:
        result = _evaluate_checkpoints(self.task, self._complete_submission())

        self.assertIsNotNone(result)
        score, detail = result or (None, {})
        self.assertEqual(score, 100.0)
        self.assertTrue(all(item["matched"] for item in detail["checkpoints"]))

    def test_using_book_expenses_without_tax_adjustments_reduces_score(self) -> None:
        submission = self._complete_submission()
        submission["entered_form_values"]["allowable_bad_debts"] = 28_000
        submission["entered_form_values"]["allowable_taxes"] = 177_000
        submission["entered_form_values"]["allowable_charitable_contribution"] = 90_000
        submission["entered_form_values"]["tax_depreciation"] = 92_000
        submission["entered_form_values"]["other_deductions"] = 176_500

        result = _evaluate_checkpoints(self.task, submission)

        self.assertIsNotNone(result)
        score, detail = result or (None, {})
        self.assertEqual(score, 69.0)
        failed = {item["id"] for item in detail["checkpoints"] if not item["matched"]}
        self.assertEqual(failed, {"bad-debts", "taxes", "contribution", "depreciation", "other"})

    def test_false_positive_schedule_m3_diagnostic_fails_exact_set(self) -> None:
        submission = self._complete_submission()
        submission["identified_red_flags"].append("Schedule M-3 is required")

        result = _evaluate_checkpoints(self.task, submission)

        self.assertIsNotNone(result)
        score, detail = result or (None, {})
        self.assertEqual(score, 94.0)
        flag_checkpoint = next(item for item in detail["checkpoints"] if item["id"] == "flags")
        self.assertFalse(flag_checkpoint["matched"])


if __name__ == "__main__":
    unittest.main()
