import ast
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
import unittest

from app.services.english_listening import attach_listening_bank, load_listening_bank, select_listening_task, task_for_issued_attempt, regional_english_definition

def definition(locale=None):
    module = ast.parse(Path("app/services/default_assessments.py").read_text(encoding="utf-8"))
    catalog = next(node.value for node in module.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "DEFAULT_ASSESSMENTS" for target in node.targets))
    item = next(ast.literal_eval(node) for node in catalog.elts if any(isinstance(key, ast.Constant) and key.value == "id" and isinstance(value, ast.Constant) and value.value == "professional-english-communication" for key, value in zip(node.keys, node.values)))
    return regional_english_definition(item, locale) if locale else attach_listening_bank(item)

class EnglishListeningTest(unittest.TestCase):
    def test_bank_audio_and_question_evidence_are_complete(self):
        bank = load_listening_bank()
        self.assertGreaterEqual(len(bank["conversations"]), 30)
        for conversation in bank["conversations"]:
            audio = Path("app/web_assessment_react/public") / conversation.get("audio_url", f"/assessment-audio/conversations/{conversation['id']}.mp3").lstrip("/")
            self.assertTrue(audio.is_file(), str(audio))
            self.assertGreater(audio.stat().st_size, 100_000)

    def test_selection_varies_and_always_keeps_the_correct_key(self):
        original = definition()["task"]
        before = deepcopy(original)
        signatures = set()
        for seed in range(100):
            selected = select_listening_task(original, str(seed))
            ids = selected["metadata"]["listening_selection"]["conversation_ids"]
            signatures.add(tuple(ids))
            meetings = {next(row["meeting_id"] for row in load_listening_bank()["conversations"] if row["id"] == item_id) for item_id in ids}
            self.assertEqual(len(meetings), 1)
            self.assertEqual(len(selected["expected_output"]["objective_answers"]), 18)
            listening = selected["metadata"]["sections"][0]
            self.assertEqual(len(listening["items"]), 7)
            for question in [item for item in listening["items"] if item["type"] == "choice"]:
                self.assertEqual(selected["expected_output"]["objective_answers"][question["id"]], question["answer"])
                self.assertIn(question["answer"], question["options"])
            self.assertNotIn("listening_bank", selected["metadata"])
        self.assertGreater(len(signatures), 5)
        self.assertEqual(original, before)

    def test_restart_avoids_both_previous_conversations(self):
        task = definition()["task"]
        first = select_listening_task(task, "first")["metadata"]["listening_selection"]["conversation_ids"]
        second = select_listening_task(task, "second", previous_ids=tuple(first))["metadata"]["listening_selection"]["conversation_ids"]
        self.assertFalse(set(first) & set(second))

    def test_issue_snapshot_survives_bank_edits_and_resume(self):
        task = definition()["task"]
        stored = SimpleNamespace(id=3, assessment_id=2, type="english_language", title="English", description="", instructions="", marks=100, metadata_json=task["metadata"], expected_output_json=task["expected_output"], grading_config_json=task["grading_config"])
        issue = SimpleNamespace(id=100, access_key="unguessable-invitation-key", result_json={"existing": True})
        first = task_for_issued_attempt(stored, issue, create=True)
        self.assertTrue(issue.result_json["existing"])
        stored.metadata_json = {}; stored.expected_output_json = {}
        resumed = task_for_issued_attempt(stored, issue, create=True)
        self.assertEqual(first.metadata_json, resumed.metadata_json)
        self.assertEqual(first.expected_output_json, resumed.expected_output_json)
        first.expected_output_json.clear()
        self.assertTrue(task_for_issued_attempt(stored, issue).expected_output_json)

    def test_new_excerpts_preserve_sharealike_credit_and_balanced_questions(self):
        for row in load_listening_bank()["conversations"]:
            if row.get("source") != "EdAcc Corpus":
                continue
            task = definition(row["locales"][0])["task"]
            previous = tuple(other["id"] for other in task["metadata"]["listening_bank"]["conversations"] if other["id"] != row["id"])
            selected = select_listening_task(task, "credit-review", previous_ids=previous)
            audio = selected["metadata"]["sections"][0]["items"][0]
            self.assertEqual(audio["conversation_id"], row["id"])
            self.assertEqual(audio["license"], "CC BY-SA 4.0")
            self.assertIn("CC BY-SA 4.0", audio["attribution"])
            self.assertEqual(sum(q["skill"] == "detail" for q in row["questions"]), 2)
            self.assertEqual(sum(q["skill"] == "inference" for q in row["questions"]), 2)
            self.assertEqual(sum(q["skill"] in {"purpose", "attitude"} for q in row["questions"]), 2)

    def test_legacy_session_and_non_english_tasks_are_unchanged(self):
        task = SimpleNamespace(type="english_language", metadata_json={"listening_bank": load_listening_bank()})
        issue = SimpleNamespace(result_json={})
        self.assertIs(task_for_issued_attempt(task, issue), task)
        task.type = "accounting"
        self.assertIs(task_for_issued_attempt(task, issue, create=True), task)

    def test_regions_have_disjoint_pools_and_one_random_audio(self):
        pools = []
        for locale in ("en-US", "en-GB"):
            task = definition(locale)["task"]
            self.assertEqual(task["metadata"]["english_locale"], locale)
            ids = set()
            for seed in range(200):
                selected = select_listening_task(task, str(seed))
                ids.update(selected["metadata"]["listening_selection"]["conversation_ids"])
                self.assertEqual(len(selected["metadata"]["listening_selection"]["conversation_ids"]), 1)
                self.assertEqual(len(selected["expected_output"]["objective_answers"]), 18)
            self.assertEqual(len(ids), 15)
            pools.append(ids)
        self.assertFalse(pools[0] & pools[1])
        self.assertIn("Summarize", definition("en-US")["task"]["metadata"]["sections"][2]["items"][0]["prompt"])
        self.assertIn("Summarise", definition("en-GB")["task"]["metadata"]["sections"][2]["items"][0]["prompt"])

    def test_recruiter_readiness_is_factual_and_uncalibrated(self):
        us = definition("en-US")["task"]["metadata"]["listening_quality"]
        uk = definition("en-GB")["task"]["metadata"]["listening_quality"]
        self.assertEqual(us["recording_count"], 15)
        self.assertEqual(us["scripted_count"], 2)
        self.assertEqual(us["natural_count"], 13)
        self.assertEqual(uk["natural_count"], 15)
        self.assertEqual(uk["duration_min_seconds"], 108)
        self.assertEqual(us["calibration_status"], "Not calibrated")
        self.assertTrue(any("all-role" in warning for warning in us["warnings"]))

if __name__ == "__main__":
    unittest.main()
