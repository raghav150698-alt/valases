"""Cache the current official EdAcc release; no content is activated automatically."""
import argparse
import json
from pathlib import Path
import shutil
import urllib.request
from concurrent.futures import ThreadPoolExecutor
import hashlib
import tarfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "english-listening-source" / "edacc"
METADATA_URL = "https://datashare.ed.ac.uk/server/api/core/bitstreams/819f726e-1a65-4b3c-88d2-efdf0a7021ce"


def extract_recordings(archive):
    """Extract only configured WAV files, never archive-controlled paths."""
    bank = json.loads((ROOT / "app/content/english_listening_bank.json").read_text(encoding="utf-8"))
    wanted = {f'{row["meeting_id"]}.wav' for row in bank["conversations"] if row.get("source") == "EdAcc Corpus"}
    with tarfile.open(archive, mode="r|gz") as source:
        for member in source:
            filename = Path(member.name).name
            if filename not in wanted or not member.isfile():
                continue
            temporary = CACHE / f"{filename}.extracting"
            with source.extractfile(member) as recording, temporary.open("wb") as output:
                shutil.copyfileobj(recording, output)
            if temporary.stat().st_size != member.size:
                raise ValueError(f"Incomplete source recording: {filename}")
            temporary.replace(CACHE / filename)
            print(f"Extracted {filename}", flush=True)
            wanted.remove(filename)
            if not wanted:
                return
    if wanted:
        raise ValueError(f"Recordings missing from archive: {sorted(wanted)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata-only", action="store_true")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--extract-only", action="store_true", help="Extract configured recordings from the cached complete archive")
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    if args.extract_only:
        extract_recordings(CACHE / "edacc_v1.0.tar.gz")
        return
    with urllib.request.urlopen(METADATA_URL, timeout=60) as response:
        metadata = json.load(response)
    (CACHE / "release.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    expected = metadata["sizeBytes"]
    target = CACHE / "edacc_v1.0.tar.gz"
    if args.metadata_only:
        print(f"Official release: {expected:,} bytes", flush=True)
        return
    if target.exists() and target.stat().st_size == expected:
        print("Source archive already cached", flush=True)
        extract_recordings(target)
        return
    partial = target.with_suffix(target.suffix + ".part")
    offset = partial.stat().st_size if partial.exists() else 0
    if shutil.disk_usage(CACHE).free < expected - offset + 1_000_000_000:
        raise SystemExit("Insufficient free space for the source archive")
    parts = CACHE / "download-parts"
    parts.mkdir(exist_ok=True)
    size = 32 * 1024 * 1024
    ranges = [(start, min(start + size, expected)) for start in range(offset, expected, size)]
    def fetch_range(bounds):
        start, end = bounds
        destination = parts / f"{start}-{end}.bin"
        if destination.exists() and destination.stat().st_size == end - start:
            return destination
        request = urllib.request.Request(metadata["_links"]["content"]["href"], headers={"Range": f"bytes={start}-{end - 1}"})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    if response.status != 206 or not response.headers.get("Content-Range", "").startswith(f"bytes {start}-{end - 1}/"):
                        raise ValueError("Server did not honour the exact source range")
                    with destination.open("wb") as output:
                        shutil.copyfileobj(response, output, length=1024 * 1024)
                if destination.stat().st_size != end - start:
                    raise ValueError("Incomplete source range")
                return destination
            except (OSError, ValueError):
                if attempt == 2: raise
    received = offset
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as executor:
        for destination in executor.map(fetch_range, ranges):
            received += destination.stat().st_size
            print(f"Ranges cached {received / expected:.1%} ({received // 1_000_000} MB)", flush=True)
    assembled = CACHE / "edacc_v1.0.tar.gz.assembled"
    with assembled.open("wb") as output:
        if partial.exists():
            with partial.open("rb") as source: shutil.copyfileobj(source, output)
        for bounds in ranges:
            with (parts / f"{bounds[0]}-{bounds[1]}.bin").open("rb") as source: shutil.copyfileobj(source, output)
    checksum = metadata.get("checkSum", {})
    if checksum.get("checkSumAlgorithm", "").lower() == "md5":
        digest = hashlib.md5()
        with assembled.open("rb") as source:
            while chunk := source.read(8 * 1024 * 1024): digest.update(chunk)
        if digest.hexdigest() != checksum["value"]:
            raise SystemExit("Official source checksum mismatch; cache retained for inspection")
    assembled.replace(target)
    print(f"Cached {target.name} ({expected:,} bytes)", flush=True)
    extract_recordings(target)


if __name__ == "__main__":
    main()
