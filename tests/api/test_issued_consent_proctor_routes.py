import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.api.routes.exams import (
    IssuedCandidateConsentRequest,
    IssuedCandidateProctorEventRequest,
    _integrity_adjusted_score,
    issued_candidate_consent,
    issued_candidate_proctor_event,
)


class IssuedConsentAndProctorRouteTest(unittest.TestCase):
    def setUp(self) -> None:
        self.issue = SimpleNamespace(id=17, status="started", result_json={})
        self.db = SimpleNamespace(add=Mock(), commit=Mock(), rollback=Mock())

    def test_consent_payload_is_saved_without_proctor_event_fields(self) -> None:
        payload = IssuedCandidateConsentRequest(
            policy_version="privacy-2026-07-19",
            consent_version="candidate-consent-1.0",
            camera=True,
            microphone=False,
            recording=False,
        )

        with patch("app.api.routes.exams._issued_issue_from_bearer_token", return_value=self.issue):
            response = issued_candidate_consent(payload, "Bearer test", self.db)

        self.assertTrue(response["accepted"])
        self.assertTrue(response["persisted"])
        self.assertTrue(self.issue.result_json["proctoring"]["consent"]["camera"])
        self.db.commit.assert_called_once()

    def test_phone_event_routes_to_review_without_score_adjustment(self) -> None:
        payload = IssuedCandidateProctorEventRequest(
            event_type="mobile_phone_detected",
            severity="critical",
            details={"confidence": 0.82, "consecutive_frames": 3, "duration_ms": 1700},
        )

        with patch("app.api.routes.exams._issued_issue_from_bearer_token", return_value=self.issue):
            response = issued_candidate_proctor_event(payload, "Bearer test", self.db)

        state = self.issue.result_json["proctoring"]
        self.assertEqual(response["warning_count"], 1)
        self.assertEqual(response["disposition"], "review")
        self.assertEqual(state["mobile_phone_detection_count"], 1)
        self.assertEqual(state["integrity_penalty_pct"], 0.0)
        self.assertFalse(state["automatic_score_deduction"])
        self.assertFalse(state["is_flagged"])
        self.assertTrue(state["mandatory_review"])

    def test_almost_certain_phone_event_remains_high_confidence_flagged(self) -> None:
        payload = IssuedCandidateProctorEventRequest(
            event_type="mobile_phone_detected",
            severity="warning",
            details={"confidence": 0.96, "consecutive_frames": 4, "duration_ms": 1800},
        )

        with patch("app.api.routes.exams._issued_issue_from_bearer_token", return_value=self.issue):
            response = issued_candidate_proctor_event(payload, "Bearer test", self.db)

        state = self.issue.result_json["proctoring"]
        self.assertEqual(response["disposition"], "high_confidence_flag")
        self.assertTrue(response["is_flagged"])
        self.assertTrue(state["is_flagged"])
        self.assertEqual(state["high_confidence_flag_count"], 1)
        self.assertEqual(state["integrity_penalty_pct"], 0.0)
        self.assertFalse(response["should_terminate"])

    def test_client_critical_severity_cannot_elevate_weak_model_signal(self) -> None:
        payload = IssuedCandidateProctorEventRequest(
            event_type="mobile_phone_detected",
            severity="critical",
            details={"confidence": 0.30, "consecutive_frames": 1, "duration_ms": 200},
        )

        with patch("app.api.routes.exams._issued_issue_from_bearer_token", return_value=self.issue):
            response = issued_candidate_proctor_event(payload, "Bearer test", self.db)

        state = self.issue.result_json["proctoring"]
        self.assertEqual(response["disposition"], "ignore")
        self.assertFalse(state["mandatory_review"])
        self.assertFalse(state["is_flagged"])

    def test_integrity_evidence_never_changes_the_assessment_score(self) -> None:
        state = {"integrity_penalty_pct": 30.0, "automatic_score_deduction": True}
        self.assertEqual(_integrity_adjusted_score(82.5, state), 82.5)
        self.assertEqual(state["integrity_penalty_pct"], 0.0)
        self.assertFalse(state["automatic_score_deduction"])

    def test_fullscreen_exit_is_recoverable_warning(self) -> None:
        payload = IssuedCandidateProctorEventRequest(
            event_type="fullscreen_exited",
            severity="warning",
            details={"reason": "Fullscreen was exited"},
        )

        with patch("app.api.routes.exams._issued_issue_from_bearer_token", return_value=self.issue):
            response = issued_candidate_proctor_event(payload, "Bearer test", self.db)

        state = self.issue.result_json["proctoring"]
        self.assertEqual(response["warning_count"], 0)
        self.assertEqual(response["disposition"], "ignore")
        self.assertFalse(response["should_terminate"])
        self.assertFalse(state["terminated"])
        self.assertEqual(self.issue.status, "started")

    def test_overlapping_voice_is_recruiter_review_flag_without_candidate_warning(self) -> None:
        payload = IssuedCandidateProctorEventRequest(
            event_type="possible_overlapping_voice_activity_advisory",
            severity="info",
            details={"overlap_score": 0.81, "duration_ms": 3000},
        )

        with patch("app.api.routes.exams._issued_issue_from_bearer_token", return_value=self.issue):
            response = issued_candidate_proctor_event(payload, "Bearer test", self.db)

        state = self.issue.result_json["proctoring"]
        self.assertEqual(response["warning_count"], 0)
        self.assertFalse(response["should_terminate"])
        self.assertEqual(response["disposition"], "review")
        self.assertTrue(state["mandatory_review"])
        self.assertIn("Sustained possible overlapping speech was detected", state["review_reasons"])

    def test_repeated_policy_events_flag_but_never_terminate(self) -> None:
        response = None
        with patch("app.api.routes.exams._issued_issue_from_bearer_token", return_value=self.issue):
            for index in range(8):
                response = issued_candidate_proctor_event(
                    IssuedCandidateProctorEventRequest(
                        event_type="fullscreen_exited",
                        severity="warning",
                        details={"client_event_id": f"fullscreen-{index}"},
                    ),
                    "Bearer test",
                    self.db,
                )

        self.assertIsNotNone(response)
        self.assertEqual(response["disposition"], "high_confidence_flag")
        self.assertFalse(response["should_terminate"])
        self.assertEqual(self.issue.status, "started")
        self.assertFalse(self.issue.result_json["proctoring"]["terminated"])


if __name__ == "__main__":
    unittest.main()
