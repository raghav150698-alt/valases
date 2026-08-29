import unittest

from app.api.routes.exams import _apply_issued_review_signal, _integrity_adjusted_score


class IssuedIntegrityScoringTest(unittest.TestCase):
    def test_high_confidence_phone_event_is_flagged_without_score_penalty(self) -> None:
        state = {"events": []}

        decision = _apply_issued_review_signal(
            state,
            "mobile_phone_detected",
            {"consecutive_frames": 3, "duration_ms": 1200},
            confidence=0.96,
        )

        self.assertIsNotNone(decision)
        self.assertEqual(decision.disposition, "high_confidence_flag")
        self.assertEqual(state["mobile_phone_detection_count"], 1)
        self.assertTrue(state["mandatory_review"])
        self.assertTrue(state["is_flagged"])
        self.assertEqual(_integrity_adjusted_score(82.5, state), 82.5)
        self.assertEqual(state["integrity_penalty_pct"], 0.0)
        self.assertFalse(state["automatic_score_deduction"])

    def test_low_signal_is_ignored_and_scores_are_never_adjusted(self) -> None:
        state = {"events": []}

        decision = _apply_issued_review_signal(
            state,
            "look_away_over_2s",
            {"duration_ms": 2000},
        )

        self.assertIsNotNone(decision)
        self.assertEqual(decision.disposition, "ignore")
        self.assertEqual(state["ignored_event_count"], 1)
        self.assertEqual(_integrity_adjusted_score(8.0, {"integrity_penalty_pct": 30}), 8.0)
        self.assertIsNone(_integrity_adjusted_score(None, state))


if __name__ == "__main__":
    unittest.main()
