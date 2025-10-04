#!/usr/bin/env python3
"""
APGMS folder scanner:
 - Recursively scans a directory
 - Extracts text from .txt/.md/.docx/.pdf
 - Scores each file against APGMS patent concepts
 - Outputs Markdown + CSV reports

Usage:
    py apgms_scan.py "C:\\Users\\matth\\OneDrive\\Desktop\\apgms-final"
"""

import sys
import os
import re
import csv
import json
import hashlib
import datetime
from collections import Counter, defaultdict

# Lightweight extractors
from pathlib import Path

try:
    import chardet
except ImportError:
    chardet = None

try:
    import docx  # python-docx
except ImportError:
    docx = None

try:
    from PyPDF2 import PdfReader
except ImportError:
    PdfReader = None


# --------------------------
# Configuration
# --------------------------

DEFAULT_ROOT = r"C:\Users\matth\OneDrive\Desktop\apgms-final"

# Patent concept checklist (keywords & phrases).
# You can tweak/expand freely; synonyms are grouped.
CONCEPTS = {
    "OWA (One-Way Accounts)": [
        r"\bone[-\s]?way account\b", r"\bOWA\b", r"\bdeposit[-\s]?only\b",
        r"\bno debit primitive\b", r"\ballow-?list(ed)?\b"
    ],
    "RPT (Reconciliation Pass Token)": [
        r"\bRPT\b", r"\breconciliation pass token\b", r"\bgreen[-\s]?light token\b",
        r"\bsigned token\b", r"\bHSM\b", r"\bhardware[-\s]?backed\b"
    ],
    "BAS Lodgment / Labels": [
        r"\bBAS\b", r"\bW1\b", r"\bW2\b", r"\b1A\b", r"\b1B\b", r"\blodg(e|ment)\b"
    ],
    "PAYGW": [r"\bPAYGW\b", r"\bwithholding\b"],
    "GST": [r"\bGST\b", r"\b1A\b", r"\b1B\b", r"\binput[-\s]?tax(ed|)\b", r"\bGST[-\s]?free\b"],
    "ATO Rails / IDs": [
        r"\bPRN\b", r"\bCRN\b", r"\bEFT\b", r"\bBPAY\b", r"\bATO\b"
    ],
    "Banking Rails": [r"\bPayTo\b", r"\bNPP\b", r"\bBECS\b", r"\bISO\s?20022\b", r"\bCAMT\b"],
    "Data Integrity": [
        r"\bMerkle\b", r"\bhash[-\s]?chain(ed)?\b", r"\bappend[-\s]?only\b", r"\bidempotent\b"
    ],
    "Reconciliation & Anomalies": [
        r"\breconciliation\b", r"\banomaly\b", r"\bthreshold\b", r"\bvariance\b", r"\bdup(licate)? rate\b",
        r"\bgap minutes\b", r"\bdelta vs baseline\b"
    ],
    "Security": [r"\bmTLS\b", r"\bJWT\b", r"\bMFA\b", r"\bencryption\b", r"\bAES[-\s]?256\b"],
    "ATO Integration": [r"\bSBR\b", r"\bPLS\b", r"\bDSP\b", r"\bOperational Security\b", r"\bSTP\b"],
    "Alternatives (No-OWA)": [r"\bsplit[-\s]?payment\b", r"\bsettlement split\b", r"\bPayTo sweep\b",
                              r"\bescrow\b", r"\bsurety\b", r"\bmarketplace\b"],
    "Evidence Bundle": [r"\bevidence bundle\b", r"\breceipt hash\b", r"\bstatement\b"],
    "Claims & Patent Structure": [
        r"\bclaims?\b", r"\babstract\b", r"\btechnical field\b", r"\bbackground\b", r"\bsummary\b",
        r"\bdetailed description\b", r"\bappendix\b", r"\bembodiments?\b", r"\bfig(ure)?s?\b"
    ]
}

# File types we try to read text from:
TEXT_EXTS = {".txt", ".md", ".markdown", ".csv", ".json"}
DOCX_EXTS = {".docx"}
PDF_EXTS  = {".pdf"}

# Max bytes to read from large text files (to keep it snappy)
MAX_TEXT_BYTES = 5_000_000  # ~5 MB


# --------------------------
# Helpers
# --------------------------

def sha256_path(path: Path) -> str:
    h = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                h.update(chunk)
        return h.hexdigest()
    except Exception:
        return ""

def detect_encoding(data: bytes) -> str:
    if chardet is None:
        return "utf-8"
    res = chardet.detect(data)
    return res["encoding"] or "utf-8"

def read_text_file(path: Path) -> str:
    try:
        with open(path, "rb") as f:
            data = f.read(MAX_TEXT_BYTES)
        enc = detect_encoding(data)
        return data.decode(enc, errors="replace")
    except Exception as e:
        return f"__READ_ERROR__: {e}"

def read_docx_file(path: Path) -> str:
    if docx is None:
        return "__READ_ERROR__: python-docx not installed"
    try:
        d = docx.Document(str(path))
        return "\n".join(para.text for para in d.paragraphs)
    except Exception as e:
        return f"__READ_ERROR__: {e}"

def read_pdf_file(path: Path) -> str:
    if PdfReader is None:
        return "__READ_ERROR__: PyPDF2 not installed"
    try:
        reader = PdfReader(str(path))
        texts = []
        for page in reader.pages[:200]:  # safeguard
            try:
                texts.append(page.extract_text() or "")
            except Exception:
                texts.append("")
        return "\n".join(texts)
    except Exception as e:
        return f"__READ_ERROR__: {e}"

def extract_text(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in TEXT_EXTS:
        return read_text_file(path)
    if ext in DOCX_EXTS:
        return read_docx_file(path)
    if ext in PDF_EXTS:
        return read_pdf_file(path)
    return ""  # Unsupported types are skipped for content analysis

def count_concepts(text: str) -> dict:
    """Return concept hit counts and boolean coverage."""
    coverage = {}
    hits = {}
    # Normalize once
    # Lowercase is fine since patterns are case-insensitive
    for concept, patterns in CONCEPTS.items():
        total_hits = 0
        for pat in patterns:
            try:
                total_hits += len(re.findall(pat, text, flags=re.IGNORECASE))
            except re.error:
                # Bad regex — shouldn’t happen with our constants
                pass
        hits[concept] = total_hits
        coverage[concept] = total_hits > 0
    return {"hits": hits, "coverage": coverage}

def coverage_score(coverage_map: dict) -> float:
    total = len(coverage_map)
    covered = sum(1 for v in coverage_map.values() if v)
    return (covered / total) * 100 if total else 0.0

def looks_like_patent(text: str) -> bool:
    # Simple heuristic for patent-like documents
    needles = [r"\bclaims?\b", r"\babstract\b", r"\btechnical field\b", r"\bbackground\b",
               r"\bsummary\b", r"\bdetailed description\b", r"\bembodiments?\b"]
    count = sum(1 for n in needles if re.search(n, text, flags=re.IGNORECASE))
    return count >= 3

def human_size(n: int) -> str:
    for unit in ["B","KB","MB","GB","TB"]:
        if n < 1024.0:
            return f"{n:.1f}{unit}"
        n /= 1024.0
    return f"{n:.1f}PB"


# --------------------------
# Main scan
# --------------------------

def scan(root: Path):
    results = []
    for dirpath, _, filenames in os.walk(root):
        for fn in filenames:
            p = Path(dirpath) / fn
            ext = p.suffix.lower()
            if ext in TEXT_EXTS | DOCX_EXTS | PDF_EXTS:
                text = extract_text(p)
            else:
                text = ""

            size = p.stat().st_size if p.exists() else 0
            mtime = datetime.datetime.fromtimestamp(p.stat().st_mtime).isoformat() if p.exists() else ""

            # Analysis
            concept = count_concepts(text) if text and not text.startswith("__READ_ERROR__") else {"hits": {}, "coverage": {}}
            score = coverage_score(concept["coverage"]) if concept["coverage"] else 0.0
            patenty = looks_like_patent(text) if text and not text.startswith("__READ_ERROR__") else False

            results.append({
                "path": str(p),
                "name": p.name,
                "ext": ext,
                "size_bytes": size,
                "size_human": human_size(size),
                "modified": mtime,
                "sha256": sha256_path(p),
                "read_error": text.startswith("__READ_ERROR__"),
                "coverage_score": round(score, 1),
                "patent_like": patenty,
                "hits": concept["hits"],
                "coverage": concept["coverage"],
            })
    return results


# --------------------------
# Reporting
# --------------------------

def write_csv(results, out_csv: Path):
    # Flatten concept hits & coverage for CSV
    concept_names = list(CONCEPTS.keys())
    headers = [
        "path","name","ext","size_bytes","size_human","modified","sha256",
        "read_error","coverage_score","patent_like"
    ]
    for c in concept_names:
        headers.append(f"hit::{c}")
    for c in concept_names:
        headers.append(f"has::{c}")

    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(headers)
        for r in results:
            row = [
                r["path"], r["name"], r["ext"], r["size_bytes"], r["size_human"],
                r["modified"], r["sha256"], r["read_error"], r["coverage_score"], r["patent_like"]
            ]
            for c in concept_names:
                row.append(r["hits"].get(c, 0))
            for c in concept_names:
                row.append(1 if r["coverage"].get(c, False) else 0)
            w.writerow(row)

def write_markdown(results, out_md: Path, root: Path):
    concept_names = list(CONCEPTS.keys())
    total_files = len(results)
    readable = [r for r in results if not r["read_error"]]
    avg_cov = sum(r["coverage_score"] for r in readable) / len(readable) if readable else 0.0
    patent_like = sum(1 for r in results if r["patent_like"])

    # Top gaps across the folder
    gap_counter = Counter()
    for r in results:
        cov = r["coverage"]
        for c in concept_names:
            if c not in cov or not cov[c]:
                gap_counter[c] += 1
    top_gaps = gap_counter.most_common()

    # Sort by coverage desc, then name
    sorted_by_cov = sorted(results, key=lambda r: (-r["coverage_score"], r["name"].lower()))

    with open(out_md, "w", encoding="utf-8") as f:
        f.write(f"# APGMS Folder Scan Report\n\n")
        f.write(f"**Scanned root:** `{root}`\n\n")
        f.write(f"- Total files scanned: **{total_files}**\n")
        f.write(f"- Files readable (text/docx/pdf): **{len(readable)}**\n")
        f.write(f"- Avg coverage score (readable files): **{avg_cov:.1f}%**\n")
        f.write(f"- Files that look like a patent draft: **{patent_like}**\n\n")

        f.write("## Biggest Concept Gaps (across files)\n")
        if top_gaps:
            for concept, count in top_gaps:
                f.write(f"- {concept}: missing in **{count}** files\n")
        else:
            f.write("- None detected\n")
        f.write("\n")

        f.write("## File Summary (Top to Bottom by Coverage)\n\n")
        f.write("| Coverage | Patent-like | Size | Modified | File |\n")
        f.write("|---:|:---:|---:|---|---|\n")
        for r in sorted_by_cov:
            f.write(f"| {r['coverage_score']:.1f}% | {'✅' if r['patent_like'] else ''} | {r['size_human']} | {r['modified'][:19]} | `{r['path']}` |\n")
        f.write("\n")

        f.write("## Concept Hits by File\n")
        for r in sorted_by_cov:
            f.write(f"\n### {r['name']}\n")
            f.write(f"- Path: `{r['path']}`\n")
            f.write(f"- Size: {r['size_human']} | Modified: {r['modified'][:19]} | Read error: {r['read_error']}\n")
            f.write(f"- Looks like patent draft: {'Yes' if r['patent_like'] else 'No'}\n")
            f.write(f"- Coverage score: **{r['coverage_score']:.1f}%**\n")
            if r["read_error"]:
                f.write("> ⚠️ Could not read this file. Consider converting to PDF/DOCX/TXT.\n")
            else:
                # Show only nonzero hits to keep it tidy
                nonzero = {k: v for k, v in r["hits"].items() if v}
                if not nonzero:
                    f.write("_No concept hits found._\n")
                else:
                    f.write("\n**Concept hits:**\n\n")
                    for c in concept_names:
                        if r["hits"].get(c, 0):
                            f.write(f"- {c}: {r['hits'][c]}\n")

def main():
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(DEFAULT_ROOT)
    if not root.exists():
        print(f"ERROR: Path not found: {root}")
        sys.exit(1)

    print(f"Scanning: {root} ...")
    results = scan(root)
    out_csv = Path.cwd() / "apgms_scan_report.csv"
    out_md  = Path.cwd() / "apgms_scan_report.md"

    write_csv(results, out_csv)
    write_markdown(results, out_md, root)

    print(f"\nDone.\n- CSV: {out_csv}\n- Markdown: {out_md}")
    print("Tip: Open the Markdown in VS Code (preview) for an easy read.")

if __name__ == "__main__":
    main()
