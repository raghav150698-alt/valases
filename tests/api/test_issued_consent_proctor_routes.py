import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from app.api.routes.exams import (
    IssuedCandidateConsentRequest,
    IssuedCandidateProctorEventRequest,
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

    def test_phone_event_applies_integrity_adjustment(self) -> None:
        payload = IssuedCandidateProctorEventRequest(
            event_type="mobile_phone_detected",
            severity="critical",
            details={"confidence": 0.82},
        )

        with patch("app.api.routes.exams._issued_issue_from_bearer_token", return_value=self.issue):
            response = issued_candidate_proctor_event(payload, "Bearer test", self.db)

        state = self.issue.result_json["proctoring"]
        self.assertEqual(response["warning_count"], 1)
        self.assertEqual(state["mobile_phone_detection_count"], 1)
        self.assertEqual(state["integrity_penalty_pct"], 10.0)
        self.assertTrue(state["mandatory_review"])


if __name__ == "__main__":
    unittest.main()
