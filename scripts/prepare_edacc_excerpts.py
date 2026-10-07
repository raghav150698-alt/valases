"""Prepare reviewed EdAcc excerpts from locally cached, original WAV recordings.

Run fetch_edacc_sources.py first. Only bounded excerpts are bundled; trimming and
loudness normalisation preserve voices, pauses and speed. Metadata remains CC BY-SA.
"""
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def main():
    bank = json.loads((ROOT / "app/content/english_listening_bank.json").read_text(encoding="utf-8"))
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg is required")
    for row in bank["conversations"]:
        if row.get("source") != "EdAcc Corpus":
            continue
        source = ROOT / "data/english-listening-source/edacc" / f'{row["meeting_id"]}.wav'
        if not source.is_file():
            raise SystemExit(f"Missing original source: {source}. Fetch and extract this recording first.")
        destination = ROOT / "app/web_assessment_react/public" / row["audio_url"].lstrip("/")
        destination.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", str(row["start_seconds"]), "-i", str(source), "-t", str(row["duration_seconds"]), "-af", "loudnorm=I=-18:TP=-2:LRA=11", "-ar", "44100", "-ac", "1", "-b:a", "96k", str(destination)], check=True)
        print(f"Prepared {row['id']}", flush=True)

if __name__ == "__main__":
    main()
