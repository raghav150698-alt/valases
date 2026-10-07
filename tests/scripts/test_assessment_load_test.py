import asyncio
import io
import importlib.util
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "run_assessment_load_test.py"
SPEC = importlib.util.spec_from_file_location("run_assessment_load_test", SCRIPT_PATH)
load_test = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = load_test
SPEC.loader.exec_module(load_test)


class AssessmentLoadTestRunnerTest(unittest.TestCase):
    def test_cases_are_tenant_balanced_and_credentials_are_parsed(self) -> None:
        state = {"employers": {}}
        for employer_index, employer in enumerate(("first", "second", "third"), start=1):
            candidates = {}
            for candidate_index in range(1, 4):
                issue_id = employer_index * 100 + candidate_index
                candidates[f"candidate-{candidate_index}"] = {
                    "index": candidate_index,
                    "assessment_issue": {
                        "assessment_id": employer_index * 10,
                        "issued_id": issue_id,
                        "login_link": (
                            f"http://localhost:1508/#issued_key=access-key-{issue_id}"
                            if candidate_index % 2
                            else f"http://localhost:1508/?issued_key=access-key-{issue_id}"
                        ),
                        "temporary_password": f"password-{issue_id}",
                    },
                }
            state["employers"][employer] = {"candidates": candidates}

        cases = load_test.assessment_cases(state, 2)

        self.assertEqual(len(cases), 6)
        self.assertEqual({case["employer"] for case in cases}, {"first", "second", "third"})
        self.assertTrue(all(case["access_key"].startswith("access-key-") for case in cases))
        self.assertTrue(all(case["password"].startswith("password-") for case in cases))

    def test_missing_prepared_invitations_blocks_the_run(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "expected 2 prepared invitations"):
            load_test.assessment_cases(
                {
                    "employers": {
                        "first": {
                            "candidates": {
                                "candidate-1": {
                                    "index": 1,
                                    "assessment_issue": {
                                        "assessment_id": 1,
                                        "issued_id": 1,
                                        "login_link": "http://localhost:1508/?issued_key=key",
                                        "temporary_password": "password",
                                    },
                                },
                            },
                        },
                    },
                },
                2,
            )

    def test_resume_skips_submitted_sessions_and_trace_paths_hide_access_keys(self) -> None:
        state = {
            "employers": {
                "first": {
                    "candidates": {
                        "candidate-1": {
                            "index": 1,
                            "assessment_issue": {
                                "assessment_id": 10,
                                "issued_id": 101,
                                "login_link": "http://localhost:1508/?issued_key=secret-access-key-101",
                                "temporary_password": "password-101",
                            },
                        },
                        "candidate-2": {
                            "index": 2,
                            "assessment_issue": {
                                "assessment_id": 11,
                                "issued_id": 102,
                                "login_link": "http://localhost:1508/?issued_key=secret-access-key-102",
                                "temporary_password": "password-102",
                            },
                        },
                    },
                },
            },
        }

        cases = load_test.assessment_cases(state, 2, {101})

        self.assertEqual([case["issued_id"] for case in cases], [102])
        self.assertEqual(
            load_test.safe_trace_path("/exams/issued/key/secret-access-key-102/login"),
            "/exams/issued/key/{access_key}/login",
        )

    def test_run_prints_percentage_and_outcome_progress(self) -> None:
        run = load_test.LoadRun("http://127.0.0.1:8000", 2, 1, 0)

        async def fake_candidate(_client, case):
            await run.start_gate.wait()
            run.results.append({"status": "submitted" if case["issued_id"] != 3 else "failed"})

        run.candidate = fake_candidate
        output = io.StringIO()
        with redirect_stdout(output):
            asyncio.run(
                run.run(
                    [{"issued_id": 2}, {"issued_id": 3}],
                    1,
                    previously_submitted=1,
                ),
            )

        self.assertIn("Progress:  33.3%", output.getvalue())
        self.assertIn("Progress: 100.0%", output.getvalue())
        self.assertIn("submitted 2 | failed 1", output.getvalue())

    def test_clip_request_uses_multipart_and_is_traced(self) -> None:
        run = load_test.LoadRun("http://test", 1, 1, 10, clip_bytes=1024)
        captured_content_type = ""

        def handler(request):
            nonlocal captured_content_type
            captured_content_type = request.headers.get("content-type", "")
            return load_test.httpx.Response(201, json={"id": 1})

        async def exercise_request():
            transport = load_test.httpx.MockTransport(handler)
            async with load_test.httpx.AsyncClient(base_url="http://test", transport=transport) as client:
                return await run.request(
                    client,
                    {"employer": "first", "candidate_index": 1, "assessment_id": 1, "issued_id": 2},
                    "camera-clip",
                    "POST",
                    "/exams/issued/review-clips",
                    token="token",
                    files={"file": ("clip.webm", run.synthetic_clip, "video/webm")},
                    form={"evidence_type": "camera", "duration_seconds": "6"},
                )

        response = asyncio.run(exercise_request())

        self.assertEqual(response["id"], 1)
        self.assertIn("multipart/form-data", captured_content_type)
        self.assertEqual(run.events[-1]["stage"], "camera-clip")
        self.assertTrue(run.events[-1]["ok"])

    def test_flag_percentage_scales_for_small_canary(self) -> None:
        run = load_test.LoadRun(
            "http://test",
            10,
            2,
            flag_percent=10,
            clip_bytes=256,
            candidates_per_employer=10,
        )

        self.assertEqual(run.flagged_per_employer, 1)


if __name__ == "__main__":
    unittest.main()
