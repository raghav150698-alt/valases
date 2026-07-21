import unittest
from types import SimpleNamespace

from app.api.routes.exams import _candidate_task_to_dict


class CandidatePayloadIsolationTest(unittest.TestCase):
    def test_candidate_task_omits_scoring_and_private_metadata(self) -> None:
        task = SimpleNamespace(
            id=41,
            type="spreadsheet",
            title="Working capital model",
            description="Complete the model.",
            instructions="Use formulas.",
            marks=100,
            metadata_json={
                "workspace": "spreadsheet",
                "initial_spreadsheet_data": {"A1": "Input"},
                "locked_cells": ["A1"],
                "private_solution": {"B2": 125000},
            },
            expected_output_json={"B2": 125000},
            grading_config_json={
                "checkpoints": [{"source": "spreadsheet_value:B2", "expected": 125000}],
            },
        )

        payload = _candidate_task_to_dict(task)

        self.assertIsNotNone(payload)
        self.assertNotIn("marks", payload)
        self.assertNotIn("expected_output", payload)
        self.assertNotIn("grading_config", payload)
        self.assertNotIn("private_solution", payload["metadata"])
        self.assertEqual(payload["metadata"]["initial_spreadsheet_data"], {"A1": "Input"})


if __name__ == "__main__":
    unittest.main()
