import unittest
from pathlib import Path
from types import SimpleNamespace

from app.api.routes.exams import (
    _candidate_task_to_dict,
    _estimated_cefr_band,
    _language_review_outcome,
    _score_task_submission,
)
from app.services.default_assessments import get_default_assessment
from app.services.english_listening import task_for_issued_attempt


class EnglishAssessmentDefinitionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.definition = get_default_assessment("professional-english-communication")
        assert self.definition is not None

    def test_guided_assessment_has_four_strict_fifteen_minute_sections(self) -> None:
        sections = self.definition["task"]["metadata"]["sections"]
        self.assertEqual(self.definition["duration_minutes"], 60)
        self.assertEqual([section["id"] for section in sections], ["listening", "reading", "writing", "speaking"])
        self.assertTrue(all(section["minutes"] == 15 for section in sections))
        self.assertTrue(all(section.get("intro") and section.get("items") for section in sections))
        self.assertEqual(self.definition["task"]["metadata"]["format"], "guided_section_flow")
        self.assertTrue(self.definition["task"]["metadata"]["shuffle_ready"])

    def test_assessment_declares_cefr_scope_and_balanced_skill_profile(self) -> None:
        metadata = self.definition["task"]["metadata"]
        self.assertEqual(metadata["standard"]["alignment"], "CEFR-informed")
        self.assertIn("not an accredited", metadata["standard"]["disclaimer"])
        self.assertEqual(
            metadata["score_profile"]["weights"],
            {"listening": 20, "reading": 20, "writing": 30, "speaking": 30},
        )
        self.assertEqual(metadata["score_profile"]["minimum_skill_score"], 50)

    def test_listening_uses_bundled_human_audio_not_browser_speech_text(self) -> None:
        listening = self.definition["task"]["metadata"]["sections"][0]
        audio_items = [item for item in listening["items"] if item["type"] == "audio"]
        self.assertEqual(len(audio_items), 1)
        for item in audio_items:
            self.assertNotIn("voice", item)
            self.assertNotIn("text", item)
            self.assertEqual(item["source"], "AMI Meeting Corpus")
            self.assertEqual(item["license"], "CC BY 4.0")
            local_file = Path("app/web_assessment_react/public") / item["audio_url"].lstrip("/")
            self.assertTrue(local_file.is_file(), str(local_file))
            self.assertGreater(local_file.stat().st_size, 100_000)

    def test_objective_key_matches_every_choice_item_and_manual_sections_are_present(self) -> None:
        task = self.definition["task"]
        choice_items = {
            item["id"]: item["answer"]
            for section in task["metadata"]["sections"]
            for item in section["items"]
            if item["type"] in {"choice", "reading_choice"}
        }
        self.assertEqual(task["expected_output"]["objective_answers"], choice_items)
        writing = next(section for section in task["metadata"]["sections"] if section["id"] == "writing")
        speaking = next(section for section in task["metadata"]["sections"] if section["id"] == "speaking")
        listening = next(section for section in task["metadata"]["sections"] if section["id"] == "listening")
        reading = next(section for section in task["metadata"]["sections"] if section["id"] == "reading")
        self.assertEqual(len([item for item in listening["items"] if item["type"] == "choice"]), 6)
        self.assertEqual(len([item for item in reading["items"] if item["type"] == "reading_choice"]), 12)
        self.assertEqual(len(writing["items"]), 2)
        self.assertEqual(len(speaking["items"]), 4)
        self.assertTrue(speaking["requires_microphone_check"])
        self.assertTrue(all(item["max_attempts"] == 1 for item in speaking["items"]))
        self.assertTrue(all(item["allow_playback"] is False for item in speaking["items"]))

    def test_scoring_accepts_multi_response_payload(self) -> None:
        task_definition = self.definition["task"]
        task = SimpleNamespace(
            marks=100,
            expected_output_json=task_definition["expected_output"],
            grading_config_json=task_definition["grading_config"],
            type="english_language",
        )
        score, status, detail = _score_task_submission(task, {
            "objective_answers": task_definition["expected_output"]["objective_answers"],
            "writing_responses": {"w1": "Summary", "w2": "Email"},
            "speaking_recordings": {"s1": {"storage_ref": "/media/s1.webm"}},
        })
        self.assertEqual(score, 40)
        self.assertEqual(status, "manual_review")
        self.assertEqual(detail["objective_correct"], 18)
        self.assertEqual(detail["skill_scores"]["listening"]["score_pct"], 100)
        self.assertEqual(detail["skill_scores"]["reading"]["score_pct"], 100)
        self.assertEqual(detail["responses_present"], {"writing": True, "speaking": True})

    def test_language_review_builds_weighted_profile_from_rubric(self) -> None:
        ratings = {
            "writing.task_fulfilment": 4,
            "writing.organisation": 4,
            "writing.lexical_resource": 3,
            "writing.grammar_accuracy": 3,
            "speaking.task_fulfilment": 4,
            "speaking.fluency": 4,
            "speaking.language_range": 4,
            "speaking.pronunciation": 4,
        }
        outcome = _language_review_outcome(
            {"listening": 75, "reading": 83.33, "writing": 0, "speaking": 0},
            ratings,
        )
        self.assertEqual(outcome["skill_scores"]["writing"], 70)
        self.assertEqual(outcome["skill_scores"]["speaking"], 80)
        self.assertEqual(outcome["overall_score_pct"], 76.67)
        self.assertEqual(outcome["estimated_cefr"], "B2+")
        self.assertTrue(outcome["minimum_skill_threshold_met"])

    def test_listening_and_reading_keep_equal_weight_with_one_audio(self) -> None:
        definition = self.definition["task"]
        task = SimpleNamespace(marks=100, expected_output_json=definition["expected_output"], grading_config_json=definition["grading_config"], type="english_language")
        for prefix in ("l", "r"):
            answers = {key: value for key, value in definition["expected_output"]["objective_answers"].items() if key.startswith(prefix)}
            score, _, _ = _score_task_submission(task, {"objective_answers": answers})
            self.assertEqual(score, 20)

    def test_cefr_estimate_boundaries_are_stable(self) -> None:
        self.assertEqual(_estimated_cefr_band(39.99), "Below B1")
        self.assertEqual(_estimated_cefr_band(40), "B1")
        self.assertEqual(_estimated_cefr_band(55), "B2")
        self.assertEqual(_estimated_cefr_band(70), "B2+")
        self.assertEqual(_estimated_cefr_band(85), "C1")

    def test_candidate_payload_never_exposes_objective_answers(self) -> None:
        task_definition = self.definition["task"]
        task = SimpleNamespace(
            id=1,
            assessment_id=1,
            type="english_language",
            title=task_definition["title"],
            description=task_definition["description"],
            instructions=task_definition["instructions"],
            metadata_json=task_definition["metadata"],
        )
        candidate_task = _candidate_task_to_dict(task)
        items = [item for section in candidate_task["metadata"]["sections"] for item in section["items"]]
        self.assertFalse(any("answer" in item for item in items))
        self.assertFalse(any("evidence_seconds" in item for item in items))
        self.assertNotIn("listening_bank", candidate_task["metadata"])

    def test_scoring_and_candidate_payload_use_the_frozen_listening_selection(self) -> None:
        definition = self.definition["task"]
        task = SimpleNamespace(id=1, assessment_id=1, type="english_language", title=definition["title"], description=definition["description"], instructions=definition["instructions"], marks=100, metadata_json=definition["metadata"], expected_output_json=definition["expected_output"], grading_config_json=definition["grading_config"])
        issue = SimpleNamespace(id=131, access_key="test-invitation-secret", result_json={})
        assigned = task_for_issued_attempt(task, issue, create=True)
        submitted = {"objective_answers": dict(assigned.expected_output_json["objective_answers"])}
        task.expected_output_json = {}  # A later template edit must not change scoring.
        frozen = task_for_issued_attempt(task, issue)
        score, status, detail = _score_task_submission(frozen, submitted)
        self.assertEqual(score, 40)
        self.assertEqual(detail["objective_correct"], 18)
        self.assertEqual(detail["skill_scores"]["listening"]["score_pct"], 100)
        candidate = _candidate_task_to_dict(frozen)
        self.assertNotIn("listening_bank", candidate["metadata"])
        self.assertNotIn("expected_output", candidate)
        self.assertFalse(any("answer" in item or "evidence_seconds" in item for section in candidate["metadata"]["sections"] for item in section["items"]))


if __name__ == "__main__":
    unittest.main()
