import unittest
from datetime import UTC, datetime, timedelta

from app.services.proctor_event_fusion import (
    apply_proctor_event_decision,
    classify_proctor_event,
    load_proctor_fusion_policy,
)


class ProctorEventFusionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = load_proctor_fusion_policy()
        self.now = datetime(2026, 8, 29, 12, 0, tzinfo=UTC)

    def history(self, event_type: str, seconds_ago: int, details: dict | None = None) -> dict:
        return {
            "event_type": event_type,
            "details": details or {},
            "recorded_at": (self.now - timedelta(seconds=seconds_ago)).isoformat(),
        }

    def test_low_confidence_phone_noise_is_ignored(self) -> None:
        decision = classify_proctor_event(
            "mobile_phone_detected",
            details={"confidence": 0.31, "consecutive_frames": 1, "duration_ms": 300},
            policy=self.policy,
            now=self.now,
        )
        self.assertEqual(decision.disposition, "ignore")
        self.assertFalse(decision.capture_evidence)

    def test_uncertain_phone_is_sent_for_review(self) -> None:
        decision = classify_proctor_event(
            "mobile_phone_detected",
            details={"confidence": 0.76, "consecutive_frames": 3, "duration_ms": 1700},
            policy=self.policy,
            now=self.now,
        )
        self.assertEqual(decision.disposition, "review")
        self.assertFalse(decision.automatic_score_deduction)

    def test_clear_repeated_phone_is_high_confidence(self) -> None:
        decision = classify_proctor_event(
            "mobile_phone_detected",
            details={"confidence": 0.95, "consecutive_frames": 4, "duration_ms": 2100},
            policy=self.policy,
            now=self.now,
        )
        self.assertEqual(decision.disposition, "high_confidence_flag")
        self.assertEqual(decision.severity, "critical")

    def test_brief_second_face_is_review_and_sustained_is_high(self) -> None:
        review = classify_proctor_event(
            "multiple_faces_sustained",
            details={"face_count": 2, "duration_ms": 2500},
            policy=self.policy,
            now=self.now,
        )
        high = classify_proctor_event(
            "multiple_faces_sustained",
            details={"face_count": 2, "duration_ms": 6200},
            policy=self.policy,
            now=self.now,
        )
        self.assertEqual(review.disposition, "review")
        self.assertEqual(high.disposition, "high_confidence_flag")

    def test_voice_plus_second_face_is_upgraded_by_fusion(self) -> None:
        decision = classify_proctor_event(
            "possible_overlapping_voice_activity_advisory",
            details={"overlap_score": 0.84, "duration_ms": 3200},
            history=[self.history("multiple_faces_sustained", 10, {"face_count": 2, "duration_ms": 3000})],
            policy=self.policy,
            now=self.now,
        )
        self.assertEqual(decision.disposition, "high_confidence_flag")
        self.assertIn("second face", decision.reason)

    def test_gaze_never_becomes_high_confidence_by_itself(self) -> None:
        decision = classify_proctor_event(
            "look_away_sustained",
            details={"duration_ms": 60_000, "confidence": 0.99},
            history=[self.history("look_away_sustained", 20) for _ in range(10)],
            policy=self.policy,
            now=self.now,
        )
        self.assertEqual(decision.disposition, "review")

    def test_hand_movement_alone_is_ignored(self) -> None:
        decision = classify_proctor_event(
            "side_hand_activity_detected",
            details={"confidence": 0.99, "duration_ms": 10_000},
            policy=self.policy,
            now=self.now,
        )
        self.assertEqual(decision.disposition, "ignore")

    def test_high_confidence_flag_is_monotonic_after_later_noise(self) -> None:
        state: dict = {}
        high = classify_proctor_event(
            "multiple_faces_sustained",
            details={"face_count": 2, "duration_ms": 7000},
            policy=self.policy,
            now=self.now,
        )
        noise = classify_proctor_event(
            "mobile_phone_detected",
            details={"confidence": 0.20, "consecutive_frames": 1},
            policy=self.policy,
            now=self.now,
        )
        apply_proctor_event_decision(state, high)
        apply_proctor_event_decision(state, noise)
        self.assertTrue(state["is_flagged"])
        self.assertEqual(state["high_confidence_flag_count"], 1)
        self.assertEqual(state["integrity_penalty_pct"], 0.0)


if __name__ == "__main__":
    unittest.main()
