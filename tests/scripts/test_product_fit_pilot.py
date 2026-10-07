import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "run_product_fit_pilot.py"
SPEC = importlib.util.spec_from_file_location("run_product_fit_pilot", SCRIPT_PATH)
pilot = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = pilot
SPEC.loader.exec_module(pilot)


class ProductFitPilotTest(unittest.TestCase):
    def write_config(self, directory: Path, **overrides):
        payload = {
            "base_url": "http://127.0.0.1:8000",
            "run_id": "September Pilot",
            "candidate_count": 100,
            "requests_per_second": 2,
            "candidate_email_domain": "pilot.valases.com",
            "employers": [
                {
                    "key": "Employer One",
                    "name": "Employer One",
                    "email_env": "PILOT_EMAIL",
                    "password_env": "PILOT_PASSWORD",
                    "token_env": "PILOT_TOKEN",
                    "assessment_ids": [42, 43],
                },
            ],
        }
        payload.update(overrides)
        path = directory / "pilot.json"
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def test_config_and_candidate_identity_are_deterministic(self):
        with tempfile.TemporaryDirectory() as temporary:
            config = pilot.load_config(self.write_config(Path(temporary)))
        employer = config.employers[0]
        self.assertEqual(config.run_id, "september-pilot")
        self.assertEqual(pilot.job_code(config, employer), "PF-SEPTEMBER-PILOT-EMPLOYER-ONE")
        self.assertEqual(
            pilot.candidate_email(config, employer, 7),
            "september-pilot-employer-one-0007@pilot.valases.com",
        )
        self.assertEqual(employer.assessment_ids, (42, 43))

    def test_assessment_phase_requires_exact_explicit_maximum(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = self.write_config(
                Path(temporary),
                employers=[
                    {"key": f"employer-{index}", "name": "Employer", "assessment_ids": [42, 43]}
                    for index in range(1, 4)
                ],
            )
            config = pilot.load_config(path)
        with self.assertRaisesRegex(pilot.PilotError, "--confirm-assessment-invites 9"):
            pilot.validate_assessment_confirmation(config, invitations=3, confirmation=0)
        pilot.validate_assessment_confirmation(config, invitations=3, confirmation=9)

    def test_candidate_limit_and_url_are_validated(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            with self.assertRaisesRegex(pilot.PilotError, "candidate_count"):
                pilot.load_config(self.write_config(directory, candidate_count=1001))
            with self.assertRaisesRegex(pilot.PilotError, "base_url"):
                pilot.load_config(self.write_config(directory, base_url="production.example.com"))

    def test_metrics_report_latency_and_failures(self):
        metrics = pilot.Metrics()
        metrics.record("GET", "/health", 200, 10, True)
        metrics.record("GET", "/health", 503, 30, False)
        summary = metrics.summary()
        self.assertEqual(summary["calls"], 2)
        self.assertEqual(summary["failures"], 1)
        self.assertEqual(summary["success_rate_pct"], 50.0)
        self.assertEqual(summary["by_endpoint"]["GET /health"]["max_ms"], 30)

    def test_metrics_retain_request_trace_details(self):
        metrics = pilot.Metrics()
        metrics.record(
            "POST",
            "/hiring/candidates",
            422,
            18.5,
            False,
            request_id="pilot-run-employer-000001",
            error="validation failed",
        )
        self.assertEqual(metrics.events[0]["request_id"], "pilot-run-employer-000001")
        self.assertEqual(metrics.events[0]["error"], "validation failed")


if __name__ == "__main__":
    unittest.main()
