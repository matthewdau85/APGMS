from pathlib import Path
import json, sys

ROOT = Path(__file__).resolve().parents[2]
schemas_dir = ROOT / "libs" / "schemas" / "json"

processed = 0
for p in sorted(schemas_dir.glob("*.json")):
    try:
        txt = p.read_text(encoding="utf-8").strip()
        if not txt:
            print(f"[codegen] skip empty: {p}")
            continue
        json.loads(txt)  # validate it’s JSON
        print(f"[codegen] ok: {p.name}")
        processed += 1
    except Exception as e:
        print(f"[codegen] skip {p.name}: {e}")

print(f"[codegen] done, processed {processed} file(s).")
