"""Cache publisher transcript/speaker metadata without downloading audio columns."""
from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
import urllib.request
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "english-listening-source" / "edacc"

class RangeFile(io.RawIOBase):
    def __init__(self, url, size):
        self.url, self.size, self.position = url, size, 0
    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.position
    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        return self.position
    def read(self, size=-1):
        size = self.size - self.position if size < 0 else min(size, self.size - self.position)
        if size <= 0: return b""
        request = urllib.request.Request(self.url, headers={"Range": f"bytes={self.position}-{self.position + size - 1}"})
        with urllib.request.urlopen(request, timeout=90) as response:
            if response.status != 206:
                raise ValueError("Mirror does not support bounded range reads")
            data = response.read()
        self.position += len(data)
        return data

def fetch(item):
    target = CACHE / (Path(item["path"]).stem + ".metadata.json")
    if target.exists():
        return json.loads(target.read_text(encoding="utf-8"))
    url = "https://huggingface.co/datasets/edinburghcstr/edacc/resolve/main/" + item["path"]
    table = pq.ParquetFile(RangeFile(url, item["size"])).read(columns=["speaker", "text", "accent", "raw_accent", "l1"])
    rows = table.to_pylist()
    target.write_text(json.dumps(rows), encoding="utf-8")
    print(f"Cached transcript metadata: {Path(item['path']).name}", flush=True)
    return rows

def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen("https://huggingface.co/api/datasets/edinburghcstr/edacc/tree/main?recursive=true", timeout=60) as response:
        items = [item for item in json.load(response) if item["path"].endswith(".parquet")]
    with ThreadPoolExecutor(max_workers=4) as pool:
        rows = [row for batch in pool.map(fetch, items) for row in batch]
    speakers = {row["speaker"]: {key: row[key] for key in ("accent", "raw_accent", "l1")} for row in rows}
    (CACHE / "speakers.json").write_text(json.dumps(speakers, indent=2), encoding="utf-8")
    print(json.dumps(speakers, indent=2))

if __name__ == "__main__":
    main()
