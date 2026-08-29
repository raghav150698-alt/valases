import unittest
from pathlib import Path
from types import SimpleNamespace

from app.api.routes.exams import _candidate_task_to_dict, _score_task_submission
from app.services.default_assessments import get_default_assessment


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

    def test_listening_uses_bundled_human_audio_not_browser_speech_text(self) -> None:
        listening = self.definition["task"]["metadata"]["sections"][0]
        audio_items = [item for item in listening["items"] if item["type"] == "audio"]
        self.assertEqual(len(audio_items), 2)
        for item in audio_items:
            self.assertNotIn("voice", item)
            self.assertNotIn("text", item)
            self.assertIn("VOA Learning English", item["source"])
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
        self.assertEqual(len(writing["items"]), 2)
        self.assertEqual(len(speaking["items"]), 3)

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
        self.assertEqual(detail["objective_correct"], 8)
        self.assertEqual(detail["responses_present"], {"writing": True, "speaking": True})

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


if __name__ == "__main__":
    unittest.main()
