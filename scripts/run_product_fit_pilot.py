from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RESULTS_DIR = REPOSITORY_ROOT / ".pilot-runs"
SAFE_PHASES = {"plan", "preflight", "seed", "screen", "verify", "safe"}
ALL_PHASES = SAFE_PHASES | {"assessments"}
REQUIRED_PERMISSIONS = {
    "jobs.view",
    "jobs.manage",
    "candidates.view",
    "candidates.manage",
    "pipeline.view",
    "pipeline.manage",
}


class PilotError(RuntimeError):
    pass


@dataclass(frozen=True)
class EmployerConfig:
    key: str
    name: str
    email_env: str
    password_env: str
    token_env: str
    organization_id: int | None
    assessment_ids: tuple[int, ...]


@dataclass(frozen=True)
class PilotConfig:
    base_url: str
    run_id: str
    candidate_count: int
    requests_per_second: float
    timeout_seconds: float
    candidate_email_domain: str
    employers: tuple[EmployerConfig, ...]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slug(value: str, *, maximum: int = 48) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    return (normalized or "pilot")[:maximum]


def load_config(path: Path, candidate_count_override: int | None = None) -> PilotConfig:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise PilotError(f"Configuration file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise PilotError(f"Configuration is not valid JSON: {exc}") from exc

    base_url = str(raw.get("base_url") or "").strip().rstrip("/")
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise PilotError("base_url must be a complete http:// or https:// URL")
    run_id = slug(str(raw.get("run_id") or ""), maximum=40)
    candidate_count = int(candidate_count_override or raw.get("candidate_count") or 100)
    if not 1 <= candidate_count <= 1000:
        raise PilotError("candidate_count must be between 1 and 1000")
    requests_per_second = float(raw.get("requests_per_second") or 2.0)
    if not 0.1 <= requests_per_second <= 20:
        raise PilotError("requests_per_second must be between 0.1 and 20")
    timeout_seconds = float(raw.get("timeout_seconds") or 30)
    if not 5 <= timeout_seconds <= 180:
        raise PilotError("timeout_seconds must be between 5 and 180")
    candidate_email_domain = str(raw.get("candidate_email_domain") or "pilot.valases.com").strip().lower()
    if not re.fullmatch(r"[a-z0-9.-]+\.[a-z]{2,}", candidate_email_domain):
        raise PilotError("candidate_email_domain is invalid")

    employers: list[EmployerConfig] = []
    seen_keys: set[str] = set()
    for item in raw.get("employers") or []:
        key = slug(str(item.get("key") or item.get("name") or ""), maximum=32)
        if key in seen_keys:
            raise PilotError(f"Duplicate employer key: {key}")
        seen_keys.add(key)
        configured_assessment_ids = item.get("assessment_ids") or []
        if item.get("assessment_id"):
            configured_assessment_ids = [item["assessment_id"], *configured_assessment_ids]
        assessment_ids = tuple(dict.fromkeys(int(value) for value in configured_assessment_ids if value))
        employers.append(
            EmployerConfig(
                key=key,
                name=str(item.get("name") or key).strip(),
                email_env=str(item.get("email_env") or "").strip(),
                password_env=str(item.get("password_env") or "").strip(),
                token_env=str(item.get("token_env") or "").strip(),
                organization_id=int(item["organization_id"]) if item.get("organization_id") else None,
                assessment_ids=assessment_ids,
            ),
        )
    if not 1 <= len(employers) <= 10:
        raise PilotError("Configure between 1 and 10 employer accounts")
    return PilotConfig(
        base_url=base_url,
        run_id=run_id,
        candidate_count=candidate_count,
        requests_per_second=requests_per_second,
        timeout_seconds=timeout_seconds,
        candidate_email_domain=candidate_email_domain,
        employers=tuple(employers),
    )


def candidate_email(config: PilotConfig, employer: EmployerConfig, index: int) -> str:
    local = slug(f"{config.run_id}-{employer.key}-{index:04d}", maximum=62)
    return f"{local}@{config.candidate_email_domain}"


def job_code(config: PilotConfig, employer: EmployerConfig) -> str:
    return f"PF-{slug(config.run_id, maximum=24)}-{slug(employer.key, maximum=24)}".upper()[:60]


def percentile(values: list[float], percentage: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = max(0, min(len(ordered) - 1, round((len(ordered) - 1) * percentage)))
    return ordered[position]


class Metrics:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def record(
        self,
        method: str,
        path: str,
        status: int,
        elapsed_ms: float,
        ok: bool,
        *,
        request_id: str = "",
        error: str = "",
    ) -> None:
        self.events.append(
            {
                "method": method,
                "path": path,
                "status": status,
                "elapsed_ms": round(elapsed_ms, 2),
                "ok": ok,
                "request_id": request_id,
                "error": error,
            },
        )

    def summary(self) -> dict[str, Any]:
        durations = [float(item["elapsed_ms"]) for item in self.events]
        failures = [item for item in self.events if not item["ok"]]
        by_endpoint: dict[str, dict[str, Any]] = {}
        for event in self.events:
            key = f"{event['method']} {event['path']}"
            bucket = by_endpoint.setdefault(key, {"calls": 0, "failures": 0, "latencies": []})
            bucket["calls"] += 1
            bucket["failures"] += int(not event["ok"])
            bucket["latencies"].append(float(event["elapsed_ms"]))
        endpoint_summary = {}
        for key, bucket in sorted(by_endpoint.items()):
            latencies = bucket.pop("latencies")
            endpoint_summary[key] = {
                **bucket,
                "p50_ms": round(percentile(latencies, 0.50), 2),
                "p95_ms": round(percentile(latencies, 0.95), 2),
                "max_ms": round(max(latencies), 2),
            }
        return {
            "calls": len(self.events),
            "failures": len(failures),
            "success_rate_pct": round(100 * (len(self.events) - len(failures)) / max(1, len(self.events)), 2),
            "p50_ms": round(percentile(durations, 0.50), 2),
            "p95_ms": round(percentile(durations, 0.95), 2),
            "max_ms": round(max(durations), 2) if durations else 0.0,
            "by_endpoint": endpoint_summary,
        }


class PilotApi:
    def __init__(
        self,
        config: PilotConfig,
        token: str,
        metrics: Metrics,
        employer_key: str,
        trace_path: Path,
    ) -> None:
        self.metrics = metrics
        self.run_id = config.run_id
        self.employer_key = employer_key
        self.trace_path = trace_path
        self.request_counter = 0
        self.minimum_interval = 1.0 / config.requests_per_second
        self.last_request_at = 0.0
        self.client = httpx.Client(
            base_url=config.base_url,
            timeout=config.timeout_seconds,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            follow_redirects=True,
        )

    def close(self) -> None:
        self.client.close()

    def _request_id(self) -> str:
        self.request_counter += 1
        return f"pilot-{self.run_id}-{self.employer_key}-{self.request_counter:06d}"[:120]

    def _trace(self, payload: dict[str, Any]) -> None:
        self.trace_path.parent.mkdir(parents=True, exist_ok=True)
        with self.trace_path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(payload, default=str, separators=(",", ":")) + "\n")

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        expected: tuple[int, ...] = (200,),
    ) -> Any:
        delay = self.minimum_interval - (time.monotonic() - self.last_request_at)
        if delay > 0:
            time.sleep(delay)
        started = time.monotonic()
        status_code = 0
        request_id = self._request_id()
        trace = {
            "recorded_at": utc_now(),
            "run_id": self.run_id,
            "employer_key": self.employer_key,
            "request_id": request_id,
            "method": method,
            "path": path,
            "params": params or {},
        }
        try:
            response = self.client.request(
                method,
                path,
                params=params,
                json=json_body,
                headers={"X-Request-ID": request_id},
            )
            status_code = response.status_code
            elapsed_ms = (time.monotonic() - started) * 1000
            server_request_id = str(response.headers.get("x-request-id") or request_id)
            error_excerpt = "" if status_code in expected else response.text[:800].replace("\n", " ")
            self.metrics.record(
                method,
                path,
                status_code,
                elapsed_ms,
                status_code in expected,
                request_id=server_request_id,
                error=error_excerpt,
            )
            self._trace({
                **trace,
                "request_id": server_request_id,
                "status": status_code,
                "elapsed_ms": round(elapsed_ms, 2),
                "ok": status_code in expected,
                "error": error_excerpt,
            })
            if status_code not in expected:
                raise PilotError(
                    f"{method} {path} returned {status_code} [request_id={server_request_id}]: {error_excerpt}",
                )
            if status_code == 204 or not response.content:
                return None
            return response.json()
        except httpx.HTTPError as exc:
            elapsed_ms = (time.monotonic() - started) * 1000
            error_text = str(exc)[:800]
            self.metrics.record(
                method,
                path,
                status_code,
                elapsed_ms,
                False,
                request_id=request_id,
                error=error_text,
            )
            self._trace({
                **trace,
                "status": status_code,
                "elapsed_ms": round(elapsed_ms, 2),
                "ok": False,
                "error": error_text,
            })
            raise PilotError(f"{method} {path} failed [request_id={request_id}]: {exc}") from exc
        finally:
            self.last_request_at = time.monotonic()


def authenticate(config: PilotConfig, employer: EmployerConfig, metrics: Metrics) -> str:
    token = os.getenv(employer.token_env, "").strip() if employer.token_env else ""
    if token:
        return token
    email = os.getenv(employer.email_env, "").strip() if employer.email_env else ""
    password = os.getenv(employer.password_env, "") if employer.password_env else ""
    if not email or not password:
        raise PilotError(
            f"{employer.key}: set {employer.token_env or 'a token environment variable'} or both "
            f"{employer.email_env} and {employer.password_env}",
        )
    started = time.monotonic()
    try:
        response = httpx.post(
            f"{config.base_url}/auth/login",
            json={"email": email, "password": password},
            timeout=config.timeout_seconds,
        )
    except httpx.HTTPError as exc:
        metrics.record("POST", "/auth/login", 0, (time.monotonic() - started) * 1000, False)
        raise PilotError(f"{employer.key}: login failed: {exc}") from exc
    metrics.record(
        "POST", "/auth/login", response.status_code, (time.monotonic() - started) * 1000, response.status_code == 200,
    )
    if response.status_code != 200:
        raise PilotError(f"{employer.key}: login returned {response.status_code}: {response.text[:500]}")
    return str(response.json().get("access_token") or "")


def empty_state(config: PilotConfig) -> dict[str, Any]:
    return {
        "version": 1,
        "run_id": config.run_id,
        "base_url": config.base_url,
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "employers": {},
    }


def load_state(path: Path, config: PilotConfig) -> dict[str, Any]:
    if not path.exists():
        return empty_state(config)
    state = json.loads(path.read_text(encoding="utf-8"))
    if state.get("run_id") != config.run_id or state.get("base_url") != config.base_url:
        raise PilotError("Existing state belongs to a different run_id or base_url")
    return state


def save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    temporary.replace(path)


def save_state(path: Path, state: dict[str, Any]) -> None:
    state["updated_at"] = utc_now()
    save_json(path, state)


def organization_params(organization_id: int) -> dict[str, int]:
    return {"organization_id": organization_id}


def preflight(
    api: PilotApi,
    employer: EmployerConfig,
    employer_state: dict[str, Any],
) -> tuple[int, dict[str, Any]]:
    api.request("GET", "/auth/me")
    params = organization_params(employer.organization_id) if employer.organization_id else None
    workspace = api.request("GET", "/hiring/workspace", params=params)
    organization_id = int(workspace["organization"]["id"])
    permissions = set(workspace.get("permissions") or [])
    missing = sorted(REQUIRED_PERMISSIONS - permissions)
    if missing:
        raise PilotError(f"{employer.key}: account is missing permissions: {', '.join(missing)}")
    catalog = api.request("GET", "/exams/catalog/published")
    employer_state.update(
        {
            "organization_id": organization_id,
            "organization_name": workspace["organization"]["name"],
            "published_assessments": [
                {"exam_id": item["exam_id"], "title": item["title"]} for item in catalog
            ],
            "preflight_at": utc_now(),
        },
    )
    return organization_id, workspace


def ensure_job(api: PilotApi, config: PilotConfig, employer: EmployerConfig, organization_id: int) -> dict[str, Any]:
    params = organization_params(organization_id)
    code = job_code(config, employer)
    jobs = api.request("GET", "/hiring/jobs", params=params)
    existing = next((item for item in jobs if str(item.get("job_code") or "").upper() == code), None)
    if existing:
        return existing
    return api.request(
        "POST",
        "/hiring/jobs",
        params=params,
        expected=(201,),
        json_body={
            "job_code": code,
            "title": "Product Fit Pilot Operations Analyst",
            "department": "Operations",
            "location": "India - Remote",
            "employment_type": "full_time",
            "work_arrangement": "remote",
            "headcount": config.candidate_count,
            "description": "Synthetic role used to validate the Valases hiring workflow at realistic volume.",
            "responsibilities": ["Review operational data", "Communicate findings clearly"],
            "requirements": ["Two years of relevant experience", "Professional communication"],
            "skills": ["Excel", "Communication", "Operations"],
            "compensation_currency": "INR",
        },
    )


def candidate_payload(config: PilotConfig, employer: EmployerConfig, index: int) -> dict[str, Any]:
    experience = 1 + (index % 9)
    skill_sets = [
        ["Excel", "Operations"],
        ["Communication", "Customer support"],
        ["Excel", "Communication", "Operations"],
        ["Data analysis", "SQL"],
    ]
    skills = skill_sets[(index - 1) % len(skill_sets)]
    return {
        "first_name": f"Pilot{index:03d}",
        "last_name": employer.key.replace("-", " ").title(),
        "email": candidate_email(config, employer, index),
        "headline": "Synthetic product-fit pilot candidate",
        "location": ["Bengaluru", "Hyderabad", "Pune", "Chennai", "Remote"][(index - 1) % 5],
        "source": "product_fit_pilot",
        "resume_text": f"Synthetic candidate with {experience} years of experience in {', '.join(skills)}.",
        "skills": skills,
        "experience_years": experience,
        "consent_obtained": True,
    }


def seed_employer(
    api: PilotApi,
    config: PilotConfig,
    employer: EmployerConfig,
    organization_id: int,
    employer_state: dict[str, Any],
    state_path: Path,
    state: dict[str, Any],
) -> None:
    params = organization_params(organization_id)
    job = ensure_job(api, config, employer, organization_id)
    employer_state["job"] = {"id": int(job["id"]), "job_code": job["job_code"], "title": job["title"]}
    existing_candidates = {
        str(item["email"]).lower(): item for item in api.request("GET", "/hiring/candidates", params=params)
    }
    existing_applications = {
        int(item["candidate"]["id"]): item
        for item in api.request("GET", "/hiring/applications", params={**params, "job_id": int(job["id"])})
    }
    records = employer_state.setdefault("candidates", {})

    for index in range(1, config.candidate_count + 1):
        payload = candidate_payload(config, employer, index)
        email = payload["email"]
        record = records.setdefault(email, {"index": index, "email": email})
        try:
            candidate = existing_candidates.get(email)
            if not candidate:
                candidate = api.request(
                    "POST", "/hiring/candidates", params=params, json_body=payload, expected=(201,),
                )
                existing_candidates[email] = candidate
                record["candidate_created"] = True
            else:
                record["candidate_created"] = False
            candidate_id = int(candidate["id"])
            record["candidate_id"] = candidate_id
            application = existing_applications.get(candidate_id)
            if not application:
                application = api.request(
                    "POST",
                    "/hiring/applications",
                    params=params,
                    json_body={"job_id": int(job["id"]), "candidate_id": candidate_id, "source": "product_fit_pilot"},
                    expected=(201,),
                )
                existing_applications[candidate_id] = application
                record["application_created"] = True
            else:
                record["application_created"] = False
            record["application_id"] = int(application["id"])
            record["stage"] = application.get("stage", "screening")
            record.pop("error", None)
        except PilotError as exc:
            record["error"] = str(exc)
        save_state(state_path, state)


def screen_employer(
    api: PilotApi,
    organization_id: int,
    employer_state: dict[str, Any],
    state_path: Path,
    state: dict[str, Any],
) -> None:
    params = organization_params(organization_id)
    for record in employer_state.get("candidates", {}).values():
        if not record.get("application_id") or record.get("screened"):
            continue
        try:
            result = api.request(
                "POST", f"/hiring/applications/{record['application_id']}/screen", params=params,
            )
            record["screened"] = True
            record["screening"] = {
                "match_score": result.get("match_score"),
                "confidence": result.get("confidence"),
                "recommendation": result.get("recommendation"),
            }
            record.pop("error", None)
        except PilotError as exc:
            record["error"] = str(exc)
        save_state(state_path, state)


def issue_assessment_canary(
    api: PilotApi,
    employer: EmployerConfig,
    organization_id: int,
    employer_state: dict[str, Any],
    invitations: int,
    suppress_email: bool,
    state_path: Path,
    state: dict[str, Any],
) -> None:
    if not employer.assessment_ids:
        raise PilotError(f"{employer.key}: assessment_ids is required for the assessments phase")
    published_ids = {
        int(item["exam_id"])
        for item in employer_state.get("published_assessments") or []
        if item.get("exam_id")
    }
    unavailable_ids = sorted(set(employer.assessment_ids) - published_ids)
    if unavailable_ids:
        raise PilotError(
            f"{employer.key}: configured assessments are not published in this workspace: {unavailable_ids}",
        )
    candidates = sorted(employer_state.get("candidates", {}).values(), key=lambda item: int(item.get("index") or 0))
    issued = 0
    for record in candidates:
        if issued >= invitations:
            break
        if record.get("assessment_issue"):
            issued += 1
            continue
        if not record.get("application_id") or record.get("stage") not in {None, "screening"}:
            continue
        try:
            name = f"Pilot{int(record['index']):03d} {employer.key.replace('-', ' ').title()}"
            assessment_id = employer.assessment_ids[(int(record["index"]) - 1) % len(employer.assessment_ids)]
            result = api.request(
                "POST",
                f"/exams/{assessment_id}/issue",
                json_body={
                    "application_id": int(record["application_id"]),
                    "candidate_name": name,
                    "candidate_email": record["email"],
                    "send_email": not suppress_email,
                },
            )
            record["assessment_issue"] = {
                "assessment_id": assessment_id,
                "issued_id": result.get("issued_id"),
                "login_link": result.get("login_link"),
                "temporary_password": result.get("temporary_password"),
                "email_delivery": result.get("email_delivery"),
            }
            record["stage"] = "assessment"
            record.pop("error", None)
            issued += 1
        except PilotError as exc:
            record["error"] = str(exc)
        save_state(state_path, state)
    if issued < invitations:
        raise PilotError(f"{employer.key}: issued {issued}/{invitations}; inspect candidate errors in the state file")


def employer_summary(employer_state: dict[str, Any], expected: int) -> dict[str, Any]:
    records = list((employer_state.get("candidates") or {}).values())
    scores = [
        float(item["screening"]["match_score"])
        for item in records
        if isinstance(item.get("screening"), dict) and item["screening"].get("match_score") is not None
    ]
    assessment_distribution: dict[str, int] = {}
    for item in records:
        assessment_id = (item.get("assessment_issue") or {}).get("assessment_id")
        if assessment_id:
            key = str(int(assessment_id))
            assessment_distribution[key] = assessment_distribution.get(key, 0) + 1
    return {
        "organization_id": employer_state.get("organization_id"),
        "organization_name": employer_state.get("organization_name"),
        "expected_candidates": expected,
        "candidate_records": len(records),
        "applications": sum(bool(item.get("application_id")) for item in records),
        "screened": sum(bool(item.get("screened")) for item in records),
        "assessment_invitations": sum(bool(item.get("assessment_issue")) for item in records),
        "assessment_distribution": assessment_distribution,
        "errors": sum(bool(item.get("error")) for item in records),
        "average_match_score": round(statistics.mean(scores), 2) if scores else None,
        "complete": len(records) == expected and not any(item.get("error") for item in records),
    }


def build_report(config: PilotConfig, state: dict[str, Any], metrics: Metrics, phase: str) -> dict[str, Any]:
    employers = {
        employer.key: employer_summary(state.get("employers", {}).get(employer.key, {}), config.candidate_count)
        for employer in config.employers
    }
    total_expected = config.candidate_count * len(config.employers)
    return {
        "run_id": config.run_id,
        "phase": phase,
        "generated_at": utc_now(),
        "base_url": config.base_url,
        "employer_count": len(config.employers),
        "expected_candidates": total_expected,
        "employers": employers,
        "totals": {
            "candidate_records": sum(item["candidate_records"] for item in employers.values()),
            "applications": sum(item["applications"] for item in employers.values()),
            "screened": sum(item["screened"] for item in employers.values()),
            "assessment_invitations": sum(item["assessment_invitations"] for item in employers.values()),
            "errors": sum(item["errors"] for item in employers.values()),
        },
        "api": metrics.summary(),
        "interpretation": {
            "tests": "API workflow capacity, permissions, validation, idempotency, latency, and error handling",
            "does_not_test": "Human usability, browser/media permissions, assessment content quality, email inbox placement, or product-market fit",
        },
    }


def print_plan(config: PilotConfig, phase: str, invitations: int) -> None:
    total_candidates = config.candidate_count * len(config.employers)
    print(f"Run: {config.run_id}")
    print(f"Target: {config.base_url}")
    print(f"Phase: {phase}")
    print(f"Employers: {len(config.employers)}")
    print(f"Candidates/applications: {config.candidate_count} per employer ({total_candidates} total)")
    print(f"Throttle: {config.requests_per_second:.1f} requests/second per employer session")
    print("Safe phase external effects: creates one job per employer, synthetic candidates, applications and screening records.")
    if invitations:
        total = invitations * len(config.employers)
        print(f"Assessment phase maximum: {invitations} per employer ({total} total).")
        print("Assessment invitations may send email and expose temporary candidate credentials in the ignored state file.")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Resumable Valases product-fit workflow pilot runner")
    parser.add_argument("--config", type=Path, required=True, help="Path to a local pilot JSON configuration")
    parser.add_argument("--phase", choices=sorted(ALL_PHASES), default="plan")
    parser.add_argument("--candidate-count", type=int, help="Override candidate_count from configuration")
    parser.add_argument("--assessment-invites-per-employer", type=int, default=0)
    parser.add_argument(
        "--suppress-assessment-email",
        action="store_true",
        help="Create controlled load-test invitations without sending candidate email",
    )
    parser.add_argument(
        "--confirm-assessment-invites",
        type=int,
        default=0,
        help="Must exactly equal employers multiplied by --assessment-invites-per-employer",
    )
    parser.add_argument("--results-dir", type=Path, default=DEFAULT_RESULTS_DIR)
    return parser.parse_args(argv)


def validate_assessment_confirmation(config: PilotConfig, invitations: int, confirmation: int) -> None:
    if invitations < 1:
        raise PilotError("assessments phase requires --assessment-invites-per-employer of at least 1")
    if invitations > config.candidate_count:
        raise PilotError("assessment invites cannot exceed candidate_count")
    maximum = invitations * len(config.employers)
    if confirmation != maximum:
        raise PilotError(
            f"Assessment phase blocked. Re-run with --confirm-assessment-invites {maximum} to authorize at most {maximum} invitations.",
        )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        config = load_config(args.config.resolve(), args.candidate_count)
        print_plan(config, args.phase, args.assessment_invites_per_employer)
        if args.phase == "plan":
            return 0
        if args.phase == "assessments":
            validate_assessment_confirmation(
                config, args.assessment_invites_per_employer, args.confirm_assessment_invites,
            )

        results_dir = args.results_dir.resolve()
        state_path = results_dir / f"{config.run_id}.state.json"
        report_path = results_dir / f"{config.run_id}.{args.phase}.report.json"
        trace_path = results_dir / f"{config.run_id}.trace.jsonl"
        state = load_state(state_path, config)
        metrics = Metrics()
        run_errors: list[str] = []

        for employer in config.employers:
            print(f"\n[{employer.key}] starting {args.phase}")
            employer_state = state.setdefault("employers", {}).setdefault(employer.key, {})
            api: PilotApi | None = None
            try:
                token = authenticate(config, employer, metrics)
                if not token:
                    raise PilotError(f"{employer.key}: authentication returned an empty token")
                api = PilotApi(config, token, metrics, employer.key, trace_path)
                organization_id, _ = preflight(api, employer, employer_state)
                save_state(state_path, state)
                if args.phase in {"seed", "safe"}:
                    seed_employer(api, config, employer, organization_id, employer_state, state_path, state)
                if args.phase in {"screen", "safe"}:
                    if not employer_state.get("candidates"):
                        raise PilotError(f"{employer.key}: run the seed phase first")
                    screen_employer(api, organization_id, employer_state, state_path, state)
                if args.phase == "assessments":
                    if not employer_state.get("candidates"):
                        raise PilotError(f"{employer.key}: run the safe phase first")
                    issue_assessment_canary(
                        api,
                        employer,
                        organization_id,
                        employer_state,
                        args.assessment_invites_per_employer,
                        args.suppress_assessment_email,
                        state_path,
                        state,
                    )
                print(f"[{employer.key}] complete")
            except PilotError as exc:
                message = str(exc)
                employer_state["run_error"] = message
                run_errors.append(message)
                print(f"[{employer.key}] ERROR: {message}", file=sys.stderr)
            finally:
                if api:
                    api.close()
                save_state(state_path, state)

        report = build_report(config, state, metrics, args.phase)
        report["run_errors"] = run_errors
        report["trace_file"] = str(trace_path)
        save_json(report_path, report)
        print(f"\nState:  {state_path}")
        print(f"Report: {report_path}")
        print(f"Trace:  {trace_path}")
        print(json.dumps(report["totals"], indent=2))
        if run_errors or report["totals"]["errors"]:
            print("Pilot completed with errors. Inspect the report and re-run the same phase after fixing them.", file=sys.stderr)
            return 1
        return 0
    except (PilotError, OSError, ValueError) as exc:
        print(f"Pilot blocked: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
