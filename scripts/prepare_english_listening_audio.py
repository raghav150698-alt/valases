"""Fetch CC BY 4.0 AMI sources and produce the listening bank's bounded excerpts.

Original recordings/annotations are cached under ignored data/. Only compressed
excerpts enter the web bundle. No speech synthesis, speed changes or noise gate.
"""
from pathlib import Path
import argparse
import concurrent.futures
import json
import shutil
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "english-listening-source"
MIRROR = "https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus"
ANNOTATIONS = "https://groups.inf.ed.ac.uk/ami/AMICorpusAnnotations/ami_public_manual_1.6.2.zip"

def fetch(url: str, destination: Path) -> Path:
    if destination.exists():
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    with urllib.request.urlopen(url, timeout=90) as response, temporary.open("wb") as output:
        shutil.copyfileobj(response, output)
    temporary.replace(destination)
    print(f"Cached {destination.name}", flush=True)
    return destination

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources-only", action="store_true")
    args = parser.parse_args()
    bank_path = ROOT / "app" / "content" / "english_listening_bank.json"
    bank = json.loads(bank_path.read_text(encoding="utf-8")) if bank_path.exists() else {"conversations": []}
    meetings = sorted({row["meeting_id"] for row in bank["conversations"] if not row.get("audio_url")}) or ["ES2002a", "ES2004a", "IS1009a", "TS3003a"]
    jobs = [(ANNOTATIONS, CACHE / "ami_public_manual_1.6.2.zip")]
    jobs += [(f"{MIRROR}/{meeting}/audio/{meeting}.Mix-Headset.wav", CACHE / f"{meeting}.wav") for meeting in meetings]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        for result in executor.map(lambda job: fetch(*job), jobs):
            print(result.name, flush=True)
    if args.sources_only:
        return
    if not bank["conversations"]:
        raise SystemExit("No conversation bank configured")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg is required to prepare audio")
    output_dir = ROOT / "app" / "web_assessment_react" / "public" / "assessment-audio" / "conversations"
    output_dir.mkdir(parents=True, exist_ok=True)
    for row in bank["conversations"]:
        if row.get("audio_url"):
            continue  # Already bundled source recordings, such as VOA.
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-ss", str(row["start_seconds"]), "-i", str(CACHE / f'{row["meeting_id"]}.wav'), "-t", str(row["duration_seconds"]), "-af", "loudnorm=I=-18:TP=-2:LRA=11", "-ar", "44100", "-ac", "1", "-b:a", "96k", str(output_dir / f'{row["id"]}.mp3')], check=True)
        print(f"Prepared {row['id']}", flush=True)

if __name__ == "__main__":
    main()
