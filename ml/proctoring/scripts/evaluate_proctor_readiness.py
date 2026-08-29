from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.services.proctor_event_fusion import classify_proctor_event  # noqa: E402


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def nested(data: dict[str, Any], *keys: str, default: Any = None) -> Any:
    current: Any = data
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            return default
        current = current[key]
    return current


def run_policy_scenarios(policy: dict[str, Any]) -> list[dict[str, Any]]:
    scenarios = [
        ("phone_noise", "mobile_phone_detected", {"confidence": 0.31, "consecutive_frames": 1, "duration_ms": 300}, [], "ignore"),
        ("phone_uncertain", "mobile_phone_detected", {"confidence": 0.76, "consecutive_frames": 3, "duration_ms": 1700}, [], "review"),
        ("phone_clear", "mobile_phone_detected", {"confidence": 0.95, "consecutive_frames": 4, "duration_ms": 2100}, [], "high_confidence_flag"),
        ("brief_second_face", "multiple_faces_sustained", {"face_count": 2, "duration_ms": 1500}, [], "ignore"),
        ("uncertain_second_face", "multiple_faces_sustained", {"face_count": 2, "duration_ms": 2800}, [], "review"),
        ("sustained_second_face", "multiple_faces_sustained", {"face_count": 2, "duration_ms": 6200}, [], "high_confidence_flag"),
        ("short_gaze_away", "look_away_sustained", {"confidence": 0.99, "duration_ms": 4000}, [], "ignore"),
        ("long_gaze_away", "look_away_sustained", {"confidence": 0.99, "duration_ms": 12000}, [], "review"),
        ("hand_movement_only", "side_hand_activity_detected", {"confidence": 0.99, "duration_ms": 10000}, [], "ignore"),
        ("voice_noise", "possible_overlapping_voice_activity_advisory", {"overlap_score": 0.42, "duration_ms": 5000}, [], "ignore"),
        ("voice_uncertain", "possible_overlapping_voice_activity_advisory", {"overlap_score": 0.78, "duration_ms": 3200}, [], "review"),
        (
            "voice_plus_second_face",
            "possible_overlapping_voice_activity_advisory",
            {"overlap_score": 0.84, "duration_ms": 3200},
            [{"event_type": "multiple_faces_sustained", "details": {"face_count": 2, "duration_ms": 3000}, "recorded_at": datetime.now(UTC).isoformat()}],
            "high_confidence_flag",
        ),
    ]
    results: list[dict[str, Any]] = []
    for name, event_type, details, history, expected in scenarios:
        decision = classify_proctor_event(event_type, details=details, history=history, policy=policy)
        results.append(
            {
                "name": name,
                "expected": expected,
                "actual": decision.disposition,
                "passed": decision.disposition == expected,
                "matched_rule": decision.matched_rule,
            }
        )
    return results


def evaluate_reviewed_events(path: Path | None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "provided": False,
        "reviewed_event_count": 0,
        "confirmed_count": 0,
        "false_positive_count": 0,
        "uncertain_count": 0,
        "missed_detection_count": 0,
        "confirmed_rate": None,
        "estimated_precision": None,
        "estimated_recall": None,
        "schema": "CSV or JSONL fields: event_type, model_disposition, reviewer_label (confirmed|false_positive|uncertain|missed_detection)",
    }
    if path is None:
        return result
    if not path.is_file():
        raise FileNotFoundError(f"Reviewed-events file is missing: {path}")
    result["provided"] = True
    if path.suffix.lower() == ".jsonl":
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    else:
        with path.open("r", encoding="utf-8-sig", newline="") as source:
            rows = list(csv.DictReader(source))
    labels = [str(row.get("reviewer_label") or row.get("recruiter_label") or "").strip().lower() for row in rows]
    allowed = {"confirmed", "false_positive", "uncertain", "missed_detection"}
    invalid = sorted({label for label in labels if label not in allowed})
    if invalid:
        raise ValueError(f"Invalid recruiter_label values: {invalid}")
    result["reviewed_event_count"] = len(rows)
    for label in allowed:
        result[f"{label}_count"] = labels.count(label)
    decided = result["confirmed_count"] + result["false_positive_count"]
    result["confirmed_rate"] = result["confirmed_count"] / decided if decided else None
    result["estimated_precision"] = result["confirmed_rate"]
    recall_denominator = result["confirmed_count"] + result["missed_detection_count"]
    result["estimated_recall"] = result["confirmed_count"] / recall_denominator if recall_denominator else None
    return result


def markdown_report(report: dict[str, Any]) -> str:
    vision = report["vision"]
    voice = report["voice"]
    pilot = report["reviewed_pilot"]
    lines = [
        "# Proctor System Readiness Report",
        "",
        f"Generated: {report['generated_at']}",
        "",
        f"**Decision: {report['decision']}**",
        "",
        "## Safety and integrity",
        "",
        f"- Technical checks: {'PASS' if report['technical_checks_passed'] else 'FAIL'}",
        f"- Source hashes: {'PASS' if report['source_hashes_passed'] else 'FAIL'}",
        f"- Dataset leakage checks: {'PASS' if vision['leakage_checks_passed'] else 'FAIL'}",
        f"- Automatic rejection: {str(report['deployment']['automatic_rejection']).lower()}",
        f"- Automatic score deduction: {str(report['deployment']['automatic_score_deduction']).lower()}",
        f"- Human final decision: {str(report['deployment']['human_final_decision']).lower()}",
        "",
        "## Held-out model evidence",
        "",
        f"- Vision held-out mAP@50:95: {vision['held_out_map_50_95']:.4f}",
        f"- Vision held-out precision: {vision['held_out_precision']:.4f}",
        f"- Vision held-out recall: {vision['held_out_recall']:.4f}",
        f"- Phone review precision: {vision['mobile_test_precision']:.4f}",
        f"- Phone review recall: {vision['mobile_test_recall']:.4f}",
        f"- Side-watching review precision: {vision['side_watching_test_precision']:.4f}",
        f"- Mouth-opening precision: {vision['mouth_open_test_precision']:.4f} (disabled as a decision signal)",
        f"- Voice-overlap ROC-AUC: {voice['roc_auc']:.4f}",
        f"- Voice-overlap accuracy: {voice['accuracy']:.4f}",
        f"- Voice validation limitation: {voice['warning']}",
        "",
        "## Policy scenario checks",
        "",
    ]
    for scenario in report["policy_scenarios"]:
        mark = "PASS" if scenario["passed"] else "FAIL"
        lines.append(f"- {mark}: {scenario['name']} -> {scenario['actual']} (expected {scenario['expected']})")
    lines.extend(
        [
            "",
            "## Real-session pilot",
            "",
            f"- Reviewed events supplied: {pilot['reviewed_event_count']}",
            f"- Minimum before production calibration: {report['production_gate']['minimum_reviewed_events']}",
            f"- Production validated: {str(report['production_validated']).lower()}",
            "",
            "## Required next actions",
            "",
        ]
    )
    lines.extend(f"- {item}" for item in report["recommendations"])
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate an evidence-based proctor-system readiness report.")
    parser.add_argument("--vision-report", required=True)
    parser.add_argument("--voice-report", required=True)
    parser.add_argument("--fusion-policy", required=True)
    parser.add_argument("--reviewed-events")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    vision_path = Path(args.vision_report).resolve()
    voice_path = Path(args.voice_report).resolve()
    policy_path = Path(args.fusion_policy).resolve()
    output_dir = Path(args.output_dir).resolve()
    vision = load_json(vision_path)
    voice = load_json(voice_path)
    policy = load_json(policy_path)

    hash_results: list[dict[str, Any]] = []
    for name, source in (policy.get("sources") or {}).items():
        source_path = Path(str(source.get("path") or ""))
        if not source_path.is_absolute():
            source_path = ROOT / source_path
        exists = source_path.is_file()
        actual = sha256(source_path) if exists else None
        expected = str(source.get("sha256") or "")
        hash_results.append({"source": name, "exists": exists, "expected": expected, "actual": actual, "passed": exists and actual == expected})

    leakage = nested(vision, "dataset", "leakage_checks", default={}) or {}
    deployment = policy.get("deployment") or {}
    policy_scenarios = run_policy_scenarios(policy)
    reviewed = evaluate_reviewed_events(Path(args.reviewed_events).resolve() if args.reviewed_events else None)
    held_out = vision.get("held_out_test_metrics") or {}
    classes = nested(vision, "review_thresholds", "classes", default={}) or {}
    mobile = nested(classes, "mobile_use", "test", default={}) or {}
    side = nested(classes, "side_watching", "test", default={}) or {}
    mouth = nested(classes, "mouth_open", "test", default={}) or {}
    onnx_runtime_passed = nested(vision, "onnx_runtime_validation", "status") == "passed"
    deployment_safe = (
        deployment.get("automatic_rejection") is False
        and deployment.get("automatic_score_deduction") is False
        and deployment.get("human_final_decision") is True
    )
    source_hashes_passed = bool(hash_results) and all(item["passed"] for item in hash_results)
    technical_checks_passed = all(
        [
            leakage.get("status") == "passed",
            int(leakage.get("source_group_overlap") or 0) == 0,
            int(leakage.get("exact_image_hash_overlap") or 0) == 0,
            onnx_runtime_passed,
            deployment_safe,
            source_hashes_passed,
            all(item["passed"] for item in policy_scenarios),
        ]
    )

    minimum_reviewed_events = 200
    estimated_precision = reviewed.get("estimated_precision")
    estimated_recall = reviewed.get("estimated_recall")
    production_validated = bool(
        technical_checks_passed
        and reviewed["reviewed_event_count"] >= minimum_reviewed_events
        and estimated_precision is not None
        and estimated_precision >= 0.90
        and estimated_recall is not None
        and estimated_recall >= 0.90
    )
    decision = "PRODUCTION_VALIDATED" if production_validated else ("READY_FOR_CONTROLLED_PILOT" if technical_checks_passed else "NOT_READY")
    recommendations = [
        "Run in review-only shadow mode; never reject or deduct marks automatically.",
        "Collect at least 200 recruiter-reviewed events across devices, lighting, accents, genders, skin tones, glasses, and room conditions.",
        "Keep gaze, hand movement, and mouth movement from creating standalone high-confidence flags.",
        "Use short evidence clips and temporal confirmation for phone, second-person, and overlapping-voice events.",
        "Recalibrate thresholds from recruiter labels before considering broader deployment.",
    ]

    report = {
        "generated_at": datetime.now(UTC).isoformat(),
        "decision": decision,
        "technical_checks_passed": technical_checks_passed,
        "source_hashes_passed": source_hashes_passed,
        "source_hash_checks": hash_results,
        "deployment": deployment,
        "vision": {
            "framework": vision.get("framework"),
            "held_out_map_50_95": float(held_out.get("val/mAP_50_95") or 0.0),
            "held_out_precision": float(held_out.get("val/precision") or 0.0),
            "held_out_recall": float(held_out.get("val/recall") or 0.0),
            "mobile_test_precision": float(mobile.get("precision") or 0.0),
            "mobile_test_recall": float(mobile.get("recall") or 0.0),
            "side_watching_test_precision": float(side.get("precision") or 0.0),
            "mouth_open_test_precision": float(mouth.get("precision") or 0.0),
            "leakage_checks_passed": leakage.get("status") == "passed",
            "onnx_runtime_validation_passed": onnx_runtime_passed,
        },
        "voice": {
            "roc_auc": float(voice.get("roc_auc") or 0.0),
            "accuracy": float(nested(voice, "classification_report", "accuracy", default=0.0) or 0.0),
            "sample_count": int(voice.get("sample_count") or 0),
            "warning": str(voice.get("warning") or "No limitation recorded"),
        },
        "policy_scenarios": policy_scenarios,
        "reviewed_pilot": reviewed,
        "production_gate": {"minimum_reviewed_events": minimum_reviewed_events, "minimum_precision": 0.90, "minimum_recall": 0.90},
        "production_validated": production_validated,
        "recommendations": recommendations,
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "proctor_readiness_report.json"
    markdown_path = output_dir / "proctor_readiness_report.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    markdown_path.write_text(markdown_report(report), encoding="utf-8")
    print(f"decision={decision}")
    print(f"technical_checks_passed={str(technical_checks_passed).lower()}")
    print(f"production_validated={str(production_validated).lower()}")
    print(f"json_report={json_path}")
    print(f"markdown_report={markdown_path}")
    if not technical_checks_passed:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
