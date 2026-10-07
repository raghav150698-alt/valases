from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx


def percentile(values: list[float], ratio: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[round((len(ordered) - 1) * ratio)]


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def safe_trace_path(path: str) -> str:
    if path.startswith("/exams/issued/key/") and path.endswith("/login"):
        return "/exams/issued/key/{access_key}/login"
    return path


def assessment_cases(
    state: dict[str, Any],
    per_employer: int,
    previously_submitted_ids: set[int] | None = None,
) -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    completed_ids = previously_submitted_ids or set()
    for employer_key, employer_state in (state.get("employers") or {}).items():
        candidates = sorted(
            (employer_state.get("candidates") or {}).values(),
            key=lambda item: int(item.get("index") or 0),
        )
        prepared = [item for item in candidates if item.get("assessment_issue")][:per_employer]
        if len(prepared) != per_employer:
            raise RuntimeError(
                f"{employer_key}: expected {per_employer} prepared invitations, found {len(prepared)}",
            )
        for candidate in prepared:
            issue = candidate["assessment_issue"]
            if int(issue.get("issued_id") or 0) in completed_ids:
                continue
            parsed_link = urlparse(str(issue.get("login_link") or ""))
            fragment = parse_qs(parsed_link.fragment)
            query = parse_qs(parsed_link.query)
            access_key = str((fragment.get("issued_key") or query.get("issued_key") or [""])[0])
            password = str(issue.get("temporary_password") or "")
            if not access_key or not password:
                raise RuntimeError(f"{employer_key}: candidate {candidate.get('index')} has incomplete credentials")
            cases.append(
                {
                    "employer": employer_key,
                    "candidate_index": int(candidate.get("index") or 0),
                    "assessment_id": int(issue.get("assessment_id") or 0),
                    "issued_id": int(issue.get("issued_id") or 0),
                    "access_key": access_key,
                    "password": password,
                },
            )
    return cases


class LoadRun:
    def __init__(
        self,
        base_url: str,
        concurrency: int,
        autosaves: int,
        flag_percent: int,
        clip_bytes: int = 0,
        candidates_per_employer: int = 100,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.semaphore = asyncio.Semaphore(concurrency)
        self.autosaves = autosaves
        self.flag_percent = flag_percent
        self.flagged_per_employer = (
            math.ceil(candidates_per_employer * flag_percent / 100) if flag_percent else 0
        )
        self.clip_bytes = clip_bytes
        self.synthetic_clip = b"\x1aE\xdf\xa3" + (b"\x00" * max(0, clip_bytes - 4)) if clip_bytes else b""
        self.events: list[dict[str, Any]] = []
        self.results: list[dict[str, Any]] = []
        self.start_gate = asyncio.Event()

    async def request(
        self,
        client: httpx.AsyncClient,
        case: dict[str, Any],
        stage: str,
        method: str,
        path: str,
        *,
        token: str = "",
        payload: dict[str, Any] | None = None,
        files: dict[str, tuple[str, bytes, str]] | None = None,
        form: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        request_id = f"load-{case['employer']}-{case['issued_id']}-{stage}"
        headers = {"X-Request-ID": request_id}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        started = time.perf_counter()
        status_code = 0
        error = ""
        try:
            response = await client.request(
                method,
                path,
                headers=headers,
                json=payload if files is None else None,
                files=files,
                data=form,
            )
            status_code = response.status_code
            if status_code < 200 or status_code >= 300:
                error = response.text[:500].replace("\n", " ")
                raise RuntimeError(f"{stage} returned {status_code}: {error}")
            return response.json()
        except Exception as exc:
            if not error:
                error = str(exc)[:500]
            raise
        finally:
            recorded_path = safe_trace_path(path)
            self.events.append(
                {
                    "recorded_at": datetime.now(timezone.utc).isoformat(),
                    "employer": case["employer"],
                    "candidate_index": case["candidate_index"],
                    "assessment_id": case["assessment_id"],
                    "issued_id": case["issued_id"],
                    "stage": stage,
                    "method": method,
                    "path": recorded_path,
                    "status": status_code,
                    "elapsed_ms": round((time.perf_counter() - started) * 1000, 1),
                    "ok": 200 <= status_code < 300,
                    "request_id": request_id,
                    "error": error,
                },
            )

    async def candidate(self, client: httpx.AsyncClient, case: dict[str, Any]) -> None:
        await self.start_gate.wait()
        started = time.perf_counter()
        result = {
            "employer": case["employer"],
            "candidate_index": case["candidate_index"],
            "assessment_id": case["assessment_id"],
            "issued_id": case["issued_id"],
            "status": "failed",
            "failed_stage": None,
            "error": "",
        }
        async with self.semaphore:
            stage = "login"
            try:
                login = await self.request(
                    client,
                    case,
                    stage,
                    "POST",
                    "/exams/issued/key-login",
                    payload={"access_key": case["access_key"], "password": case["password"]},
                )
                token = str(login["token"])
                stage = "assessment"
                paper = await self.request(client, case, stage, "GET", "/exams/issued/me", token=token)
                stage = "consent"
                await self.request(
                    client,
                    case,
                    stage,
                    "POST",
                    "/exams/issued/consent",
                    token=token,
                    payload={
                        "policy_version": "load-test-v1",
                        "consent_version": "load-test-v1",
                        "camera": True,
                        "microphone": True,
                        "recording": True,
                    },
                )
                questions = paper.get("questions") or []
                answers = {
                    str(question["question_id"]): [int(question["options"][0]["id"])]
                    for question in questions
                    if question.get("options")
                }
                submitted_data = {
                    "load_test": True,
                    "response": "Synthetic concurrent-load response",
                    "entered_form_values": {},
                    "final_sheet_json": {},
                    "calculated_values_json": {},
                    "formulas_json": {},
                    "language_responses": {},
                }
                submission_id = f"load_{case['issued_id']:08d}_{case['candidate_index']:04d}"
                for revision in range(1, self.autosaves + 1):
                    stage = f"autosave-{revision}"
                    await self.request(
                        client,
                        case,
                        stage,
                        "POST",
                        "/exams/issued/autosave",
                        token=token,
                        payload={
                            "submission_id": submission_id,
                            "revision": revision,
                            "answers": answers,
                            "submitted_data": submitted_data,
                            "current_question_index": min(revision, max(0, len(questions) - 1)),
                            "time_taken_seconds": revision * 30,
                            "timer_state": {"remaining_assessment_sec": max(0, 3600 - revision * 30)},
                        },
                    )
                if case["candidate_index"] <= self.flagged_per_employer:
                    stage = "proctor-event"
                    await self.request(
                        client,
                        case,
                        stage,
                        "POST",
                        "/exams/issued/proctor-event",
                        token=token,
                        payload={
                            "event_type": "window_blur",
                            "severity": "warning",
                            "details": {
                                "client_event_id": f"load-flag-{case['issued_id']}",
                                "confidence": 0.92,
                                "duration_ms": 2200,
                                "load_test": True,
                            },
                        },
                    )
                    if self.synthetic_clip:
                        for evidence_type in ("camera", "screen"):
                            stage = f"{evidence_type}-clip"
                            await self.request(
                                client,
                                case,
                                stage,
                                "POST",
                                "/exams/issued/review-clips",
                                token=token,
                                files={
                                    "file": (
                                        f"synthetic-{evidence_type}.webm",
                                        self.synthetic_clip,
                                        "video/webm",
                                    ),
                                },
                                form={
                                    "evidence_type": evidence_type,
                                    "event_type": "window_blur",
                                    "duration_seconds": "6",
                                },
                            )
                stage = "submit"
                await self.request(
                    client,
                    case,
                    stage,
                    "POST",
                    "/exams/issued/submit",
                    token=token,
                    payload={
                        "submission_id": submission_id,
                        "answers": answers,
                        "submitted_data": submitted_data,
                        "time_taken_seconds": 120,
                        "proctoring_events": [],
                    },
                )
                result["status"] = "submitted"
            except Exception as exc:
                result["failed_stage"] = stage
                result["error"] = str(exc)[:500]
            finally:
                result["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
                self.results.append(result)

    async def run(
        self,
        cases: list[dict[str, Any]],
        timeout_seconds: float,
        *,
        previously_submitted: int = 0,
    ) -> None:
        limits = httpx.Limits(max_connections=max(20, len(cases)), max_keepalive_connections=max(20, len(cases)))
        async with httpx.AsyncClient(base_url=self.base_url, timeout=timeout_seconds, limits=limits) as client:
            tasks = [asyncio.create_task(self.candidate(client, case)) for case in cases]
            await asyncio.sleep(0)
            self.start_gate.set()
            total_sessions = previously_submitted + len(cases)
            initial_pct = (previously_submitted / total_sessions) * 100
            print(
                f"Progress: {initial_pct:5.1f}% | processed {previously_submitted}/{total_sessions} "
                f"| submitted {previously_submitted} | failed 0",
                flush=True,
            )
            next_progress_pct = (int(initial_pct) // 5 + 1) * 5
            completed_this_run = 0
            for completed_task in asyncio.as_completed(tasks):
                await completed_task
                completed_this_run += 1
                processed = previously_submitted + completed_this_run
                progress_pct = (processed / total_sessions) * 100
                if progress_pct >= next_progress_pct or processed == total_sessions:
                    submitted_this_run = sum(1 for item in self.results if item["status"] == "submitted")
                    failed_this_run = completed_this_run - submitted_this_run
                    print(
                        f"Progress: {progress_pct:5.1f}% | processed {processed}/{total_sessions} "
                        f"| submitted {previously_submitted + submitted_this_run} "
                        f"| failed {failed_this_run}",
                        flush=True,
                    )
                    while next_progress_pct <= progress_pct:
                        next_progress_pct += 5


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Concurrent Valases assessment lifecycle load test")
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--state", type=Path, required=True)
    parser.add_argument("--candidates-per-employer", type=int, default=100)
    parser.add_argument("--concurrency", type=int, default=60)
    parser.add_argument("--autosaves", type=int, default=2)
    parser.add_argument("--flag-percent", type=int, default=10)
    parser.add_argument("--clip-bytes", type=int, default=0)
    parser.add_argument("--timeout-seconds", type=float, default=60)
    parser.add_argument("--results-dir", type=Path, default=Path(".pilot-runs"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not 1 <= args.candidates_per_employer <= 100:
        raise SystemExit("candidates-per-employer must be between 1 and 100")
    total = args.candidates_per_employer * 3
    if not 1 <= args.concurrency <= total:
        raise SystemExit(f"concurrency must be between 1 and {total}")
    if not 1 <= args.autosaves <= 10:
        raise SystemExit("autosaves must be between 1 and 10")
    if not 0 <= args.flag_percent <= 100:
        raise SystemExit("flag-percent must be between 0 and 100")
    if not 0 <= args.clip_bytes <= 12_000_000:
        raise SystemExit("clip-bytes must be between 0 and 12000000")
    config = load_json(args.config)
    state = load_json(args.state)
    args.results_dir.mkdir(parents=True, exist_ok=True)
    run_id = str(config.get("run_id") or "assessment-load")
    trace_path = args.results_dir / f"{run_id}.assessment-load.trace.jsonl"
    report_path = args.results_dir / f"{run_id}.assessment-load.report.json"
    previous_events: list[dict[str, Any]] = []
    if trace_path.exists():
        for line in trace_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                item = json.loads(line)
                item["path"] = safe_trace_path(str(item.get("path") or ""))
                previous_events.append(item)
            except json.JSONDecodeError:
                continue
    previously_submitted_ids = {
        int(item["issued_id"])
        for item in previous_events
        if item.get("stage") == "submit" and item.get("ok") and item.get("issued_id")
    }
    cases = assessment_cases(state, args.candidates_per_employer, previously_submitted_ids)
    if not cases:
        print(f"All {args.candidates_per_employer * 3} prepared sessions were already submitted.")
        return 0
    run = LoadRun(
        str(config["base_url"]),
        args.concurrency,
        args.autosaves,
        args.flag_percent,
        args.clip_bytes,
        args.candidates_per_employer,
    )
    print(
        f"Launching {len(cases)} unfinished assessment sessions with concurrency {args.concurrency} "
        f"({len(previously_submitted_ids)} already submitted)...",
    )
    started = time.perf_counter()
    asyncio.run(
        run.run(
            cases,
            args.timeout_seconds,
            previously_submitted=len(previously_submitted_ids),
        ),
    )
    wall_seconds = round(time.perf_counter() - started, 2)

    all_events = [*previous_events, *run.events]
    trace_path.write_text("".join(json.dumps(item, separators=(",", ":")) + "\n" for item in all_events), encoding="utf-8")
    latencies = [float(item["elapsed_ms"]) for item in run.events]
    failures = [item for item in run.results if item["status"] != "submitted"]
    status_counts = Counter(int(item["status"]) for item in run.events)
    endpoint_failures = Counter(f"{item['method']} {item['path']}" for item in run.events if not item["ok"])
    report = {
        "run_id": run_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "target_sessions": args.candidates_per_employer * 3,
        "previously_submitted": len(previously_submitted_ids),
        "attempted_sessions": len(cases),
        "concurrency": args.concurrency,
        "autosaves_per_session": args.autosaves,
        "flag_percent": args.flag_percent,
        "flagged_sessions_target": sum(
            1 for case in cases if case["candidate_index"] <= run.flagged_per_employer
        ),
        "flag_clip_bytes": args.clip_bytes,
        "flag_clip_uploads": sum(
            1 for item in run.events if item["stage"] in {"camera-clip", "screen-clip"} and item["ok"]
        ),
        "full_session_recordings_uploaded": 0,
        "retention_model": "flagged_clips_only",
        "wall_seconds": wall_seconds,
        "submitted_this_run": len(cases) - len(failures),
        "submitted_total": len(previously_submitted_ids) + len(cases) - len(failures),
        "failed": len(failures),
        "success_rate_pct": round(((len(cases) - len(failures)) / len(cases)) * 100, 2),
        "requests": len(run.events),
        "request_failures": sum(1 for item in run.events if not item["ok"]),
        "latency_ms": {
            "p50": percentile(latencies, 0.50),
            "p95": percentile(latencies, 0.95),
            "p99": percentile(latencies, 0.99),
            "max": max(latencies, default=0),
        },
        "http_statuses": dict(sorted(status_counts.items())),
        "endpoint_failures": dict(endpoint_failures),
        "failures": failures[:100],
        "trace_file": str(trace_path.resolve()),
    }
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    summary_fields = (
        "target_sessions",
        "previously_submitted",
        "attempted_sessions",
        "concurrency",
        "submitted_this_run",
        "submitted_total",
        "failed",
        "success_rate_pct",
        "requests",
        "request_failures",
        "flagged_sessions_target",
        "flag_clip_uploads",
        "full_session_recordings_uploaded",
        "retention_model",
        "wall_seconds",
        "latency_ms",
    )
    print(json.dumps({key: report[key] for key in summary_fields}, indent=2))
    print(f"Report: {report_path.resolve()}")
    print(f"Trace:  {trace_path.resolve()}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
