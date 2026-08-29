from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(path)
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def build_policy(vision: dict[str, Any], voice: dict[str, Any], gaze: dict[str, Any]) -> dict[str, Any]:
    class_results = ((vision.get("review_thresholds") or {}).get("classes") or {})
    mobile_test = ((class_results.get("mobile_use") or {}).get("test") or {})
    side_test = ((class_results.get("side_watching") or {}).get("test") or {})
    eye_test = ((class_results.get("eye_movement") or {}).get("test") or {})
    mouth_test = ((class_results.get("mouth_open") or {}).get("test") or {})
    voice_threshold = max(0.55, min(0.90, float(voice.get("threshold") or 0.65)))
    gaze_threshold = float((gaze.get("thresholds") or {}).get("suspect_away_probability") or 0.48)

    policy = {
        "version": "proctor-fusion-v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "levels": ["ignore", "review", "high_confidence_flag"],
        "deployment": {
            "automatic_rejection": False,
            "automatic_score_deduction": False,
            "human_final_decision": True,
            "high_confidence_flags_remain_flagged": True,
        },
        "calibration_summary": {
            "vision_mobile_test_precision": mobile_test.get("precision"),
            "vision_mobile_test_recall": mobile_test.get("recall"),
            "vision_side_watching_test_precision": side_test.get("precision"),
            "vision_eye_test_precision": eye_test.get("precision"),
            "vision_mouth_test_precision": mouth_test.get("precision"),
            "voice_overlap_threshold": voice_threshold,
            "gaze_away_probability_threshold": gaze_threshold,
            "gates": {
                "side_watching": "review_only",
                "mobile_use": "review_or_high_after_temporal_confirmation",
                "eye_movement": "never_standalone_high_confidence",
                "hand_move": "context_only",
                "mouth_open": "disabled_use_audio_instead",
            },
        },
        "aliases": {
            "multiple_faces_detected": "multiple_faces_sustained",
            "external_voice_detected": "possible_overlapping_voice_activity_advisory",
            "background_voice_detected": "possible_overlapping_voice_activity_advisory",
            "look_away_over_2s": "look_away_sustained",
            "gaze_away_over_3s": "look_away_sustained",
            "gaze_pattern_review_flag": "look_away_sustained",
            "browser_policy_warning": "restricted_browser_action",
            "context_menu_opened": "restricted_browser_action",
            "clipboard_action_blocked": "restricted_browser_action",
            "restricted_browser_shortcut": "restricted_browser_action",
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
                "review": [{"min_confidence": voice_threshold, "min_duration_ms": 2800}],
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
            "speaker_identity_mismatch": {
                "reason": "Repeated speech did not match the enrolled candidate voice",
                "review": [{"min_confidence": 0.80, "min_duration_ms": 1200}],
                "high_confidence": [{"min_confidence": 0.95, "min_duration_ms": 1200, "min_occurrences": 2, "within_seconds": 60}],
            },
            "face_identity_mismatch": {
                "reason": "Repeated face verification did not match the enrolled candidate",
                "review": [{"min_confidence": 0.85, "min_occurrences": 2, "within_seconds": 60}],
                "high_confidence": [{"min_confidence": 0.97, "min_occurrences": 2, "within_seconds": 60}],
            },
            "look_away_sustained": {
                "reason": "Attention remained away from the assessment for a sustained interval",
                "review": [{"min_duration_ms": 9000}],
                "high_confidence": [],
            },
            "object_detected_advisory": {
                "reason": "A potentially restricted object was repeatedly visible",
                "review": [{"min_confidence": 0.75, "min_occurrences": 2, "within_seconds": 45, "allowed_labels": ["book", "notes", "tablet", "smartphone", "cell phone"]}],
                "high_confidence": [],
            },
            "side_hand_activity_detected": {
                "reason": "Hand movement was observed",
                "review": [],
                "high_confidence": [],
            },
            "hand_near_face_repeated": {
                "reason": "Hand movement was observed",
                "review": [],
                "high_confidence": [],
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
    return policy


def main() -> None:
    root = Path(__file__).resolve().parents[3]
    parser = argparse.ArgumentParser(description="Build the calibrated three-level proctor event-fusion policy.")
    parser.add_argument("--vision-report", default=str(root / "data/proctoring/models/proctor_vision_ultra/rfdetr_nano_grouped_v1/proctor_vision_ultra_report.json"))
    parser.add_argument("--voice-model", default=str(root / "app/web_assessment_react/public/assets/generated/voice_overlap_model.json"))
    parser.add_argument("--gaze-model", default=str(root / "app/web_assessment_react/public/assets/generated/screen_gaze_model.json"))
    parser.add_argument("--output", default=str(root / "data/proctoring/models/fusion/proctor_fusion_policy.json"))
    parser.add_argument("--browser-output", default=str(root / "app/web_assessment_react/public/assets/generated/proctor_fusion_policy.json"))
    args = parser.parse_args()

    vision_path = Path(args.vision_report).resolve()
    voice_path = Path(args.voice_model).resolve()
    gaze_path = Path(args.gaze_model).resolve()
    output_path = Path(args.output).resolve()
    browser_output = Path(args.browser_output).resolve()
    policy = build_policy(load_json(vision_path), load_json(voice_path), load_json(gaze_path))

    def source_path(path: Path) -> str:
        try:
            return path.relative_to(root).as_posix()
        except ValueError:
            return path.as_posix()

    policy["sources"] = {
        "vision_report": {"path": source_path(vision_path), "sha256": file_sha256(vision_path)},
        "voice_model": {"path": source_path(voice_path), "sha256": file_sha256(voice_path)},
        "gaze_model": {"path": source_path(gaze_path), "sha256": file_sha256(gaze_path)},
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(policy, indent=2), encoding="utf-8")
    temporary.replace(output_path)
    browser_output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(output_path, browser_output)
    print(f"policy={output_path}")
    print(f"browser_policy={browser_output}")
    print("levels=ignore,review,high_confidence_flag")
    print("automatic_rejection=false automatic_score_deduction=false")


if __name__ == "__main__":
    main()
