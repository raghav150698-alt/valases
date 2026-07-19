from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge multiple manifest CSV files and deduplicate by path.")
    parser.add_argument("--inputs", nargs="+", required=True, help="Input manifest CSV files")
    parser.add_argument("--output", required=True, help="Output merged manifest CSV")
    args = parser.parse_args()

    frames: list[pd.DataFrame] = []
    for raw in args.inputs:
        p = Path(raw).resolve()
        if p.exists():
            frames.append(pd.read_csv(p))

    if not frames:
        raise RuntimeError("No manifest rows found to merge.")

    merged = pd.concat(frames, ignore_index=True)
    if "file_hash" in merged.columns and not merged["file_hash"].isna().all():
        merged["file_hash"] = merged["file_hash"].fillna("").astype(str)
        # Use path as fallback hash for rows without file_hash
        empty_mask = merged["file_hash"] == ""
        merged.loc[empty_mask, "file_hash"] = merged.loc[empty_mask, "path"]
        out = merged.drop_duplicates(subset=["file_hash"]).reset_index(drop=True)
    else:
        out = merged.drop_duplicates(subset=["path"]).reset_index(drop=True)

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(output_path, index=False)
    print(f"merged rows={len(out)} -> {output_path}")



if __name__ == "__main__":
    main()
