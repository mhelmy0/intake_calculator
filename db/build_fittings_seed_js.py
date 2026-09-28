"""Regenerate assets/data/fittings/recommended_v1.js from the CSV (offline fallback for the browser).

    python db/build_fittings_seed_js.py
"""
import csv
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "data", "fittings", "fittings_recommended_v1.csv")
DST = os.path.join(ROOT, "assets", "data", "fittings", "recommended_v1.js")

with open(SRC, encoding="utf-8-sig", newline="") as f:
    rows = list(csv.DictReader(f))

with open(DST, "w", encoding="utf-8") as f:
    f.write("/* GENERATED from fittings_recommended_v1.csv by db/build_fittings_seed_js.py — do not edit. */\n")
    f.write("window.RO = window.RO || {};\n")
    f.write("RO.FITTINGS_SEED = {\n  name: \"RO-Calc Recommended Fittings\", version: 1, source: \"bundled CSV\",\n  rows: ")
    f.write(json.dumps(rows, ensure_ascii=False, indent=0).replace("\n", ""))
    f.write("\n};\n")
print(f"{len(rows)} rows -> {DST}")
