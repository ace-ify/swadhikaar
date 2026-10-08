#!/usr/bin/env python3
"""Geocode public.pmjay_hospitals best-effort via OSM Nominatim.

Run:  python scripts/geocode_pmjay.py [--limit N]   (default 200)

Resumable: only rows with lat IS NULL are fetched, so re-running continues where it
stopped (and stays under tool timeouts). Nominatim policy is respected: <=1 req/sec
and a real User-Agent. We try the hospital name + district + state first; on a miss we
fall back to the district centroid and tag geo_source='district' so the map can mark
that pin approximate rather than pretend it is the exact building.
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request

ENV_PATH = os.path.join(os.path.dirname(__file__), "..", "backend", ".env")
NOMINATIM = "https://nominatim.openstreetmap.org/search"
UA = "Swadhikaar-PMJAY/1.0 (final-year project; hospital finder)"


def load_env(path):
    out = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    out[k.strip()] = v.strip().strip("'\"")
    return out


def nominatim(query):
    qs = urllib.parse.urlencode({"q": query, "format": "json", "limit": 1, "countrycodes": "in"})
    req = urllib.request.Request(f"{NOMINATIM}?{qs}", headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            data = json.load(res)
        if data:
            return round(float(data[0]["lat"]), 6), round(float(data[0]["lon"]), 6)
    except Exception as e:
        print("  nominatim error:", e)
    return None


def rest_get(url, key, path):
    req = urllib.request.Request(f"{url}/rest/v1/{path}", headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)


def rest_patch(url, key, path, body):
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=minimal"},
        method="PATCH",
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.status


# __APPEND__
def main():
    limit = 200
    if "--limit" in sys.argv:
        try:
            limit = int(sys.argv[sys.argv.index("--limit") + 1])
        except Exception:
            pass

    env = load_env(ENV_PATH)
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SECRET_KEY")
    if not url or not key or key.startswith("your-"):
        sys.exit("SUPABASE_URL / SUPABASE_SECRET_KEY missing or placeholder in backend/.env")

    rows = rest_get(url, key, f"pmjay_hospitals?select=id,name,district,state&lat=is.null&limit={limit}")
    print(f"{len(rows)} hospitals to geocode (limit {limit})")

    district_cache = {}
    done = 0
    for r in rows:
        name, district, state = r["name"], r.get("district") or "", r.get("state") or ""
        coord = nominatim(f"{name}, {district}, {state}, India")
        time.sleep(1.1)
        geo_source = "hospital"
        if not coord:
            dk = f"{district}, {state}"
            if dk not in district_cache:
                district_cache[dk] = nominatim(f"{district}, {state}, India")
                time.sleep(1.1)
            coord = district_cache[dk]
            geo_source = "district"
        if not coord:
            continue
        rest_patch(url, key, f"pmjay_hospitals?id=eq.{r['id']}", {"lat": coord[0], "lon": coord[1], "geo_source": geo_source})
        done += 1
        if done % 10 == 0:
            print(f"  {done} geocoded...")

    print(f"geocoded {done}/{len(rows)}")


if __name__ == "__main__":
    main()
