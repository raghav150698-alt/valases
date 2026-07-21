import unittest

from app.api.routes.exams import _apply_issued_integrity_event, _integrity_adjusted_score


class IssuedIntegrityScoringTest(unittest.TestCase):
    def test_phone_events_add_capped_review_penalty(self) -> None:
        state = {}

        for _ in range(4):
            _apply_issued_integrity_event(state, "mobile_phone_detected")

        self.assertEqual(state["mobile_phone_detection_count"], 4)
        self.assertEqual(state["integrity_penalty_pct"], 30.0)
        self.assertTrue(state["mandatory_review"])
        self.assertEqual(_integrity_adjusted_score(82.5, state), 52.5)

    def test_unrelated_event_does_not_change_score(self) -> None:
        state = {}

        _apply_issued_integrity_event(state, "look_away_over_2s")

        self.assertEqual(state, {})
        self.assertEqual(_integrity_adjusted_score(8.0, {"integrity_penalty_pct": 30}), 0.0)
        self.assertIsNone(_integrity_adjusted_score(None, state))


if __name__ == "__main__":
    unittest.main()
