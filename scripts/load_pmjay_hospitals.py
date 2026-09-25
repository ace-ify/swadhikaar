#!/usr/bin/env python3
"""Load AB-PMJAY empanelled hospitals from the official district-wise PDF lists
into public.pmjay_hospitals.

Run:  python scripts/load_pmjay_hospitals.py <district_pdf_url> [more_urls ...]
      python scripts/load_pmjay_hospitals.py --dry-run <url>   # parse + print, no write

The lists are first-party NHA / State-Health-Authority data ("List of Empanelled
Hospitals of District X (State) under AB-PMJAY As on DD/MM/YYYY"). Real columns:
Hospital ID, Name, Type (Government/Private), Empanelled Specialities, Nodal Officer
phone + email. There is NO coordinate or street address in these files, so the finder
is district + specialty; geocoding is a later step. The 'as on' date is carried through
as a freshness field -- empanelment changes, so a cached row is only as current as its
source file.
"""

import datetime
import json
import os
import re
import sys
import urllib.request

import fitz  # PyMuPDF (backend venv)

ENV_PATH = os.path.join(os.path.dirname(__file__), "..", "backend", ".env")
TITLE_RE = re.compile(
    r"District\s+(.+?)\s*\((.+?)\)\s*under\s+AB-?\s*PM-?JAY\s+As\s+on\s+(\d{2}/\d{2}/\d{4})",
    re.IGNORECASE,
)
HOSP_RE = re.compile(r"^HOSP\d", re.IGNORECASE)  # real IDs are HOSP+digit (HOSP6G...); excludes the "Hospital ID" header


def load_env(path):
    """Minimal .env reader. The key must never reach argv or the shell history."""
    out = {}
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip("'\"")
    return out


def clean(s):
    return (s or "").replace("\n", " ").strip()


def na_none(s):
    s = clean(s)
    return None if s.lower() in ("", "na", "n/a", "-") else s


def parse_specialities(cell):
    s = clean(cell)
    if s.lower() in ("", "na", "n/a"):
        return []
    return [p.strip() for p in s.split(",") if p.strip() and p.strip().lower() != "na"]


def parse_as_on(s):
    try:
        return datetime.datetime.strptime(s, "%d/%m/%Y").date().isoformat()
    except Exception:
        return None


def fetch_pdf(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Swadhikaar PMJAY ingest)"})
    with urllib.request.urlopen(req, timeout=90) as res:
        return res.read()


def parse_pdf(data, source_url):
    doc = fitz.open(stream=data, filetype="pdf")
    full_text = "\n".join(p.get_text() for p in doc)
    m = TITLE_RE.search(full_text)
    district = clean(m.group(1)) if m else None
    state = clean(m.group(2)) if m else None
    as_on = parse_as_on(m.group(3)) if m else None

    rows, seen = [], set()
    for page in doc:
        for tbl in page.find_tables().tables:
            for r in tbl.extract():
                cells = [clean(c) for c in r]
                # The header row has "Hospital ID" (no HOSP prefix) so it is skipped;
                # locate the id cell rather than trusting a fixed column offset.
                hid_idx = next((i for i, c in enumerate(cells) if HOSP_RE.match(c)), None)
                if hid_idx is None:
                    continue
                hid = cells[hid_idx]
                if hid in seen:
                    continue

                def col(i):
                    return cells[i] if i < len(cells) else ""

                name = clean(col(hid_idx + 1))
                if not name:
                    continue
                seen.add(hid)
                rows.append({
                    "hospital_id": hid,
                    "name": name[:300],
                    "hospital_type": clean(col(hid_idx + 2)) or None,
                    "specialities": parse_specialities(col(hid_idx + 3)),
                    "phone": na_none(col(hid_idx + 4)),
                    "email": na_none(col(hid_idx + 5)),
                    "district": district,
                    "state": state,
                    "source_url": source_url,
                    "as_on": as_on,
                })
    return rows


def upsert(supabase_url, key, rows):
    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/pmjay_hospitals?on_conflict=hospital_id",
        data=json.dumps(rows).encode("utf-8"),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            # merge-duplicates makes a re-run an update (refreshed as_on), not a 409.
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as res:
        print(f"HTTP {res.status} {res.reason}")


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    urls = [a for a in args if not a.startswith("--")]
    if not urls:
        sys.exit("usage: load_pmjay_hospitals.py [--dry-run] <district_pdf_url> [more ...]")

    all_rows, seen = [], set()
    for u in urls:
        rows = parse_pdf(fetch_pdf(u), u)
        for r in rows:
            if r["hospital_id"] in seen:
                continue
            seen.add(r["hospital_id"])
            all_rows.append(r)
        where = f"{rows[0]['district']}, {rows[0]['state']}" if rows else "?"
        print(f"{u}\n  -> {len(rows)} hospitals ({where})")

    print(f"total {len(all_rows)} unique hospitals")
    if dry:
        print(json.dumps(all_rows[:6], indent=2, ensure_ascii=False))
        return

    env = load_env(ENV_PATH)
    supabase_url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SECRET_KEY")
    if not supabase_url or not key or key.startswith("your-"):
        sys.exit("SUPABASE_URL / SUPABASE_SECRET_KEY missing or placeholder in backend/.env (use --dry-run to parse only)")
    upsert(supabase_url, key, all_rows)


if __name__ == "__main__":
    main()
