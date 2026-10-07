"""Audit stored listening media and emit a reproducible content-readiness report."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.services.english_listening import load_listening_bank, summarize_listening_bank


def audit(*, check_media: bool = True) -> dict:
    bank = load_listening_bank()
    public = ROOT / "app" / "web_assessment_react" / "public"
    errors = []
    media = []
    hashes = {}
    excerpt_ranges = {}
    ffprobe = shutil.which("ffprobe") if check_media else None
    ffmpeg = shutil.which("ffmpeg") if check_media else None
    if check_media and not ffprobe:
        errors.append("ffprobe is unavailable; media decoding and duration were not checked")
    if check_media and not ffmpeg:
        errors.append("ffmpeg is unavailable; full audio decoding was not checked")
    for row in bank["conversations"]:
        relative = row.get("audio_url", f"/assessment-audio/conversations/{row['id']}.mp3")
        target = (public / relative.lstrip("/")).resolve()
        if not target.is_relative_to(public.resolve()):
            errors.append(f"{row['id']}: audio path escapes public assets")
            continue
        if not target.is_file():
            errors.append(f"{row['id']}: stored audio is missing")
            continue
        entry = {"id": row["id"], "bytes": target.stat().st_size, "declared_seconds": row["duration_seconds"]}
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        entry["sha256"] = digest
        if digest in hashes:
            errors.append(f"{row['id']}: duplicates the audio bytes of {hashes[digest]}")
        hashes[digest] = row["id"]
        if row.get("source") == "EdAcc Corpus":
            start, end = row["start_seconds"], row["start_seconds"] + row["duration_seconds"]
            for old_start, old_end, old_id in excerpt_ranges.get(row["meeting_id"], []):
                if min(end, old_end) - max(start, old_start) > 0.01:
                    errors.append(f"{row['id']}: overlaps source speech from {old_id}")
            excerpt_ranges.setdefault(row["meeting_id"], []).append((start, end, row["id"]))
        if ffprobe:
            result = subprocess.run([ffprobe, "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(target)], capture_output=True, text=True)
            if result.returncode:
                errors.append(f"{row['id']}: ffprobe failed")
            else:
                data = json.loads(result.stdout)
                actual = float(data.get("format", {}).get("duration", 0))
                entry["actual_seconds"] = round(actual, 3)
                if not any(stream.get("codec_type") == "audio" for stream in data.get("streams", [])):
                    errors.append(f"{row['id']}: no audio stream")
                if abs(actual - row["duration_seconds"]) > 1:
                    errors.append(f"{row['id']}: duration differs by more than one second")
        if ffmpeg:
            result = subprocess.run([ffmpeg, "-v", "error", "-i", str(target), "-f", "null", "-"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            if result.returncode:
                errors.append(f"{row['id']}: audio decoding failed")
        media.append(entry)
    return {"bank_version": bank["version"], "stored_recordings": len(media), "unique_audio_files": len(hashes), "regional_recordings": sum(bool(row.get("locales")) and row.get("status") == "ready" for row in bank["conversations"]), "media_checked": bool(ffprobe and ffmpeg),
            "regions": {locale: summarize_listening_bank({**bank, "conversations": [row for row in bank["conversations"] if locale in row.get("locales", [])]}) for locale in ("en-US", "en-GB")},
            "media": media, "errors": errors}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--skip-media", action="store_true", help="Inventory only; explicitly marks media unverified")
    args = parser.parse_args()
    report = audit(check_media=not args.skip_media)
    rendered = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered)
    sys.exit(bool(report["errors"]))
