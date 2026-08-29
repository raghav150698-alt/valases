from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable, Mapping


POLICY_PATH = Path(__file__).resolve().parents[2] / "data/proctoring/models/fusion/proctor_fusion_policy.json"
VALID_DISPOSITIONS = {"ignore", "review", "high_confidence_flag"}


@dataclass(frozen=True)
class ProctorEventDecision:
    disposition: str
    severity: str
    event_type: str
    canonical_event_type: str
    reason: str
    policy_confidence: float
    raw_confidence: float | None
    capture_evidence: bool
    candidate_warning: bool
    policy_version: str
    matched_rule: str
    automatic_rejection: bool = False
    automatic_score_deduction: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


_POLICY_CACHE_KEY: tuple[int, int] | None = None
_POLICY_CACHE: dict[str, Any] | None = None


def _default_policy() -> dict[str, Any]:
    """Safe fallback used only when the generated policy is unavailable."""
    return {
        "version": "proctor-fusion-v1-safe-fallback",
        "deployment": {
            "automatic_rejection": False,
            "automatic_score_deduction": False,
            "human_final_decision": True,
        },
        "aliases": {
            "multiple_faces_detected": "multiple_faces_sustained",
            "external_voice_detected": "possible_overlapping_voice_activity_advisory",
            "look_away_over_2s": "look_away_sustained",
            "gaze_away_over_3s": "look_away_sustained",
            "gaze_pattern_review_flag": "look_away_sustained",
        },
        "signals": {
            "mobile_phone_detected": {
                "reason": "A mobile phone was repeatedly detected with strong confidence",
                "candidate_warning": True,
                "review": [{"min_confidence": 0.55, "min_consecutive_frames": 3, "min_duration_ms": 1200}],
                "high_confidence": [
                    {"min_confidence": 0.92, "min_consecutive_frames": 3, "min_duration_ms": 1200},
                    {"min_confidence": 0.80, "min_consecutive_frames": 3, "min_occurrences": 2, "within_seconds": 60},
                ],
            },
            "multiple_faces_sustained": {
                "reason": "More than one face remained visible",
                "review": [{"min_face_count": 2, "min_duration_ms": 2400}],
                "high_confidence": [
                    {"min_face_count": 2, "min_duration_ms": 5000},
                    {"min_face_count": 2, "min_occurrences": 2, "within_seconds": 30},
                ],
            },
            "possible_overlapping_voice_activity_advisory": {
                "reason": "Sustained possible overlapping speech was detected",
                "review": [{"min_confidence": 0.65, "min_duration_ms": 2800}],
                "high_confidence": [
                    {"min_confidence": 0.92, "min_duration_ms": 5000, "min_occurrences": 2, "within_seconds": 45},
                    {
                        "min_confidence": 0.82,
                        "min_duration_ms": 2800,
                        "corroborating_any": ["multiple_faces_sustained", "speaker_identity_mismatch"],
                        "within_seconds": 45,
                    },
                ],
            },
            "look_away_sustained": {
                "reason": "Attention remained away from the assessment for a sustained interval",
                "review": [{"min_duration_ms": 9000}],
                "high_confidence": [],
            },
            "object_detected_advisory": {
                "reason": "A potentially restricted object was repeatedly visible",
                "review": [
                    {
                        "min_confidence": 0.75,
                        "min_occurrences": 2,
                        "within_seconds": 45,
                        "allowed_labels": ["book", "notes", "tablet", "smartphone", "cell phone"],
                    },
                ],
                "high_confidence": [],
            },
            "speaker_identity_mismatch": {
                "reason": "Repeated speech did not match the enrolled candidate voice",
                "review": [{"min_confidence": 0.80, "min_duration_ms": 1200}],
                "high_confidence": [
                    {"min_confidence": 0.95, "min_duration_ms": 1200, "min_occurrences": 2, "within_seconds": 60},
                ],
            },
            "face_identity_mismatch": {
                "reason": "Repeated face verification did not match the enrolled candidate",
                "review": [{"min_confidence": 0.85, "min_occurrences": 2, "within_seconds": 60}],
                "high_confidence": [
                    {"min_confidence": 0.97, "min_occurrences": 2, "within_seconds": 60},
                ],
            },
            "fullscreen_exited": {
                "reason": "Fullscreen was exited repeatedly",
                "candidate_warning": True,
                "review": [{"min_occurrences": 3, "within_seconds": 120}],
                "high_confidence": [{"min_occurrences": 8, "within_seconds": 300}],
            },
            "assessment_tab_hidden": {
                "reason": "The assessment tab was repeatedly hidden",
                "candidate_warning": True,
                "review": [{"min_occurrences": 3, "within_seconds": 120}],
                "high_confidence": [{"min_occurrences": 8, "within_seconds": 300}],
            },
            "window_focus_lost": {
                "reason": "The assessment window repeatedly lost focus",
                "candidate_warning": True,
                "review": [{"min_occurrences": 4, "within_seconds": 120}],
                "high_confidence": [{"min_occurrences": 10, "within_seconds": 300}],
            },
            "restricted_browser_action": {
                "reason": "Restricted browser actions were repeatedly attempted",
                "candidate_warning": True,
                "review": [{"min_occurrences": 2, "within_seconds": 120}],
                "high_confidence": [{"min_occurrences": 5, "within_seconds": 300}],
            },
        },
        "fusion_rules": [
            {
                "name": "voice_and_second_person",
                "signals": ["possible_overlapping_voice_activity_advisory", "multiple_faces_sustained"],
                "within_seconds": 45,
                "disposition": "high_confidence_flag",
                "reason": "Overlapping speech and a sustained second face were both detected",
            },
            {
                "name": "voice_and_speaker_mismatch",
                "signals": ["possible_overlapping_voice_activity_advisory", "speaker_identity_mismatch"],
                "within_seconds": 60,
                "disposition": "high_confidence_flag",
                "reason": "Overlapping speech and a non-candidate voice were both detected",
            },
        ],
    }


def reset_proctor_fusion_policy_cache() -> None:
    global _POLICY_CACHE_KEY, _POLICY_CACHE
    _POLICY_CACHE_KEY = None
    _POLICY_CACHE = None


def load_proctor_fusion_policy(path: Path | None = None) -> dict[str, Any]:
    global _POLICY_CACHE_KEY, _POLICY_CACHE
    policy_path = (path or POLICY_PATH).resolve()
    try:
        stat = policy_path.stat()
        cache_key = (stat.st_mtime_ns, stat.st_size)
    except OSError:
        return _default_policy()
    if path is None and _POLICY_CACHE_KEY == cache_key and _POLICY_CACHE is not None:
        return _POLICY_CACHE
    try:
        policy = json.loads(policy_path.read_text(encoding="utf-8"))
        if not isinstance(policy, dict) or not isinstance(policy.get("signals"), dict):
            raise ValueError("invalid policy structure")
        deployment = policy.setdefault("deployment", {})
        # These are non-negotiable safety constraints, even if a generated file is malformed.
        deployment["automatic_rejection"] = False
        deployment["automatic_score_deduction"] = False
        deployment["human_final_decision"] = True
    except (OSError, ValueError, json.JSONDecodeError):
        policy = _default_policy()
    if path is None:
        _POLICY_CACHE_KEY = cache_key
        _POLICY_CACHE = policy
    return policy


def _safe_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, number))


def _safe_number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _parse_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _canonical_event_type(event_type: Any, policy: Mapping[str, Any]) -> str:
    normalized = str(event_type or "").strip().lower()
    aliases = policy.get("aliases") if isinstance(policy.get("aliases"), Mapping) else {}
    return str(aliases.get(normalized) or normalized)


def _history_rows(
    history: Iterable[Mapping[str, Any]],
    policy: Mapping[str, Any],
    now: datetime,
    within_seconds: float | None,
) -> list[Mapping[str, Any]]:
    rows: list[Mapping[str, Any]] = []
    for row in history:
        if within_seconds is not None:
            timestamp = _parse_timestamp(row.get("recorded_at") or row.get("created_at"))
            if timestamp is None or (now - timestamp).total_seconds() > within_seconds:
                continue
        rows.append({**row, "_canonical_event_type": _canonical_event_type(row.get("event_type"), policy)})
    return rows


def _raw_confidence(confidence: Any, details: Mapping[str, Any]) -> float | None:
    candidates = [
        confidence,
        details.get("confidence"),
        details.get("overlap_score"),
        details.get("speaker_mismatch_probability"),
        details.get("model_probability"),
        details.get("score"),
    ]
    for candidate in candidates:
        value = _safe_float(candidate)
        if value is not None:
            return value
    return None


def _criterion_matches(
    criterion: Mapping[str, Any],
    canonical_event_type: str,
    details: Mapping[str, Any],
    confidence: float | None,
    history: Iterable[Mapping[str, Any]],
    policy: Mapping[str, Any],
    now: datetime,
) -> bool:
    minimum_confidence = criterion.get("min_confidence")
    if minimum_confidence is not None and (confidence is None or confidence < float(minimum_confidence)):
        return False
    if _safe_number(details.get("duration_ms")) < _safe_number(criterion.get("min_duration_ms")):
        return False
    if _safe_number(details.get("consecutive_frames")) < _safe_number(criterion.get("min_consecutive_frames")):
        return False
    if _safe_number(details.get("face_count")) < _safe_number(criterion.get("min_face_count")):
        return False

    allowed_labels = [str(value).strip().lower() for value in (criterion.get("allowed_labels") or [])]
    if allowed_labels:
        label = str(details.get("object_label") or details.get("label") or "").strip().lower()
        if label not in allowed_labels:
            return False

    within_seconds = _safe_number(criterion.get("within_seconds"), 0.0) or None
    recent = _history_rows(history, policy, now, within_seconds)
    occurrences = 1 + sum(
        1 for row in recent if row.get("_canonical_event_type") == canonical_event_type
    )
    if occurrences < int(criterion.get("min_occurrences") or 1):
        return False

    corroborating_any = {
        _canonical_event_type(value, policy) for value in (criterion.get("corroborating_any") or [])
    }
    if corroborating_any and not any(row.get("_canonical_event_type") in corroborating_any for row in recent):
        return False
    return True


def classify_proctor_event(
    event_type: str,
    *,
    confidence: float | None = None,
    details: Mapping[str, Any] | None = None,
    history: Iterable[Mapping[str, Any]] = (),
    policy: Mapping[str, Any] | None = None,
    now: datetime | None = None,
) -> ProctorEventDecision:
    resolved_policy = dict(policy or load_proctor_fusion_policy())
    event_details = dict(details or {})
    occurred_at = (now or datetime.now(UTC)).astimezone(UTC)
    normalized_event_type = str(event_type or "").strip().lower()
    canonical = _canonical_event_type(normalized_event_type, resolved_policy)
    signal_rules = resolved_policy.get("signals") if isinstance(resolved_policy.get("signals"), Mapping) else {}
    rule = signal_rules.get(canonical) if isinstance(signal_rules.get(canonical), Mapping) else None
    raw_confidence = _raw_confidence(confidence, event_details)

    disposition = "ignore"
    matched_rule = "no_matching_policy"
    reason = "The signal did not meet the calibrated review threshold"
    candidate_warning = False
    if rule is not None:
        reason = str(rule.get("reason") or canonical.replace("_", " ").title())
        candidate_warning = bool(rule.get("candidate_warning", False))
        for criterion in rule.get("high_confidence") or []:
            if isinstance(criterion, Mapping) and _criterion_matches(
                criterion, canonical, event_details, raw_confidence, history, resolved_policy, occurred_at,
            ):
                disposition = "high_confidence_flag"
                matched_rule = "signal.high_confidence"
                break
        if disposition == "ignore":
            for criterion in rule.get("review") or []:
                if isinstance(criterion, Mapping) and _criterion_matches(
                    criterion, canonical, event_details, raw_confidence, history, resolved_policy, occurred_at,
                ):
                    disposition = "review"
                    matched_rule = "signal.review"
                    break

    if disposition != "ignore":
        current_and_recent = {canonical}
        for fusion in resolved_policy.get("fusion_rules") or []:
            if not isinstance(fusion, Mapping):
                continue
            within = _safe_number(fusion.get("within_seconds"), 0.0) or None
            recent = _history_rows(history, resolved_policy, occurred_at, within)
            present = current_and_recent | {str(row.get("_canonical_event_type") or "") for row in recent}
            required = {_canonical_event_type(value, resolved_policy) for value in (fusion.get("signals") or [])}
            if required and required.issubset(present):
                fused_disposition = str(fusion.get("disposition") or "review")
                if fused_disposition in VALID_DISPOSITIONS:
                    disposition = fused_disposition
                    matched_rule = f"fusion.{fusion.get('name') or 'unnamed'}"
                    reason = str(fusion.get("reason") or reason)
                    break

    if raw_confidence is not None:
        policy_confidence = raw_confidence
    else:
        duration_component = min(0.45, _safe_number(event_details.get("duration_ms")) / 12_000.0)
        occurrence_component = min(0.25, _safe_number(event_details.get("consecutive_frames")) / 20.0)
        policy_confidence = min(0.99, 0.30 + duration_component + occurrence_component)
    if disposition == "high_confidence_flag":
        policy_confidence = max(0.97, policy_confidence)
    elif disposition == "review":
        policy_confidence = max(0.50, policy_confidence)
    else:
        policy_confidence = min(0.49, policy_confidence)

    severity = {
        "ignore": "info",
        "review": "warning",
        "high_confidence_flag": "critical",
    }[disposition]
    return ProctorEventDecision(
        disposition=disposition,
        severity=severity,
        event_type=normalized_event_type,
        canonical_event_type=canonical,
        reason=reason,
        policy_confidence=round(float(policy_confidence), 6),
        raw_confidence=raw_confidence,
        capture_evidence=disposition != "ignore",
        candidate_warning=candidate_warning and disposition != "ignore",
        policy_version=str(resolved_policy.get("version") or "unknown"),
        matched_rule=matched_rule,
    )


def apply_proctor_event_decision(state: dict[str, Any], decision: ProctorEventDecision) -> None:
    """Persist a monotonic review/flag state without applying candidate penalties."""
    state["automatic_rejection"] = False
    state["automatic_score_deduction"] = False
    state["integrity_penalty_pct"] = 0.0
    state.setdefault("review_event_count", 0)
    state.setdefault("high_confidence_flag_count", 0)
    state.setdefault("ignored_event_count", 0)
    state.setdefault("review_reasons", [])
    state.setdefault("high_confidence_reasons", [])
    state.setdefault("is_flagged", False)

    if decision.canonical_event_type == "mobile_phone_detected" and decision.disposition != "ignore":
        state["mobile_phone_detection_count"] = int(state.get("mobile_phone_detection_count") or 0) + 1

    if decision.disposition == "high_confidence_flag":
        state["mandatory_review"] = True
        state["is_flagged"] = True
        state["high_confidence_flag_count"] = int(state["high_confidence_flag_count"]) + 1
        if decision.reason not in state["high_confidence_reasons"]:
            state["high_confidence_reasons"] = [*state["high_confidence_reasons"][-9:], decision.reason]
        if decision.reason not in state["review_reasons"]:
            state["review_reasons"] = [*state["review_reasons"][-9:], decision.reason]
    elif decision.disposition == "review":
        state["mandatory_review"] = True
        state["review_event_count"] = int(state["review_event_count"]) + 1
        if decision.reason not in state["review_reasons"]:
            state["review_reasons"] = [*state["review_reasons"][-9:], decision.reason]
    else:
        state["ignored_event_count"] = int(state["ignored_event_count"]) + 1
