from types import SimpleNamespace
import unittest

from app.api.routes.exams import _evaluate_checkpoints
from app.services.default_assessments import get_default_assessment


class AccountingWorkbenchScoringTest(unittest.TestCase):
    def setUp(self) -> None:
        definition = get_default_assessment("month-end-close")
        self.assertIsNotNone(definition)
        assert definition is not None
        self.definition = definition
        self.task = SimpleNamespace(
            grading_config_json=definition["task"]["grading_config"],
            marks=100,
        )

    def test_accounting_case_is_persisted_in_template_metadata(self) -> None:
        metadata = self.definition["task"]["metadata"]
        case = metadata["accounting_case"]

        self.assertEqual(metadata["answer_format"], "accounting_workbench")
        self.assertEqual(case["companyName"], "Northstar Services LLC")
        self.assertEqual(case["statementBalance"], 486240)
        self.assertEqual(len(case["bankItems"]), 4)

    def test_complete_workbench_submission_scores_all_checkpoints(self) -> None:
        submitted_data = {
            "entered_form_values": {
                "adjusted_bank_cash": 474940,
                "adjusted_book_cash": 473940,
                "cash_difference": 1000,
                "ar_adjustment": 6500,
                "expense_accrual": 27500,
                "depreciation_entry": 14250,
                "duplicate_ap_correction": 9800,
            },
            "identified_red_flags": [
                "Duplicate vendor invoice",
                "AR control/subledger mismatch",
                "Unrecorded bank charge",
                "Unrecorded customer receipt",
                "Missing service accrual",
            ],
            "accounting_workspace": {
                "completed_workflows": [
                    "bank_reconciliation",
                    "receivables_reconciliation",
                    "duplicate_invoice_review",
                    "expense_accrual",
                    "depreciation",
                    "control_review",
                ],
            },
        }

        result = _evaluate_checkpoints(self.task, submitted_data)

        self.assertIsNotNone(result)
        assert result is not None
        score, detail = result
        self.assertEqual(score, 100)
        self.assertEqual(detail["earned_weight"], 100)
        self.assertTrue(all(item["matched"] for item in detail["checkpoints"]))

    def test_incorrect_reconciliation_does_not_receive_bank_checkpoint_credit(self) -> None:
        submitted_data = {
            "entered_form_values": {
                "adjusted_bank_cash": 486240,
                "adjusted_book_cash": 456380,
            },
            "identified_red_flags": [],
        }

        result = _evaluate_checkpoints(self.task, submitted_data)

        self.assertIsNotNone(result)
        assert result is not None
        score, detail = result
        self.assertEqual(score, 0)
        bank_checkpoint = next(item for item in detail["checkpoints"] if item["id"] == "bank-cash")
        self.assertFalse(bank_checkpoint["matched"])

    def test_unsupported_control_flag_fails_exact_exception_checkpoint(self) -> None:
        submitted_data = {
            "entered_form_values": {
                "adjusted_bank_cash": 474_940,
                "adjusted_book_cash": 473_940,
                "cash_difference": 1_000,
                "ar_adjustment": 6_500,
                "expense_accrual": 27_500,
                "depreciation_entry": 14_250,
                "duplicate_ap_correction": 9_800,
            },
            "identified_red_flags": [
                "Duplicate vendor invoice",
                "AR control/subledger mismatch",
                "Unrecorded bank charge",
                "Unrecorded customer receipt",
                "Missing service accrual",
                "Customer balance requires write-off",
            ],
        }

        result = _evaluate_checkpoints(self.task, submitted_data)

        self.assertIsNotNone(result)
        score, detail = result or (None, {})
        self.assertEqual(score, 85.0)
        flag_checkpoint = next(item for item in detail["checkpoints"] if item["id"] == "flags")
        self.assertFalse(flag_checkpoint["matched"])


if __name__ == "__main__":
    unittest.main()
