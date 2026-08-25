#!/usr/bin/env python3
"""Load OpenStreetMap health facilities into public.facilities.

Run:  python scripts/load_osm_facilities.py /tmp/guw.json /tmp/pat.json

Identity and coordinates come from OSM and are real. Bed and staffing counts are
NOT obtainable from any public source -- no one publishes live Indian bed counts,
that lives in each facility's own HMIS -- so they are generated here and every row
is written with capacity_source='simulated'. Anything displaying those numbers has
to show the label too.

The generated figures are derived from a hash of the OSM id, so re-running gives
identical numbers instead of reshuffling the map every load.
"""

import hashlib
import json
import os
import sys
import urllib.request

ENV_PATH = os.path.join(os.path.dirname(__file__), "..", "backend", ".env")


def load_env(path):
    """Minimal .env reader. The key must never reach argv or the shell history."""
    out = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                out[k.strip()] = v.strip().strip("'\"")
    return out


def stable_int(osm_id, salt, lo, hi):
    """Deterministic pseudo-random in [lo, hi] -- same id always yields the same value."""
    h = hashlib.sha256(f"{salt}:{osm_id}".encode()).digest()
    return lo + int.from_bytes(h[:4], "big") % (hi - lo + 1)


# OSM tags a morgue, a dental college, a diagnostic lab and a veterinary clinic all
# as amenity=hospital. None of them can receive an acute case. The first load ranked
# "GMCH Postmortem Ward" as the biggest hospital in Guwahati at 1387 beds, because
# the name matched the teaching-hospital keyword.
NOT_A_RECEIVING_FACILITY = (
    "postmortem", "post mortem", "mortuary", "morgue",
    "dental", "blood bank", "blood centre", "blood center",
    "ayurved", "homeo", "unani", "siddha",  # AYUSH -- not acute receiving
    "veterinar", "animal",
    "diagnostic", "laborator", "patholog", "imaging", "scan centre", "x-ray",
    "physiotherap", "optical", "eye clinic", "spectacle",
    "pharmac", "medical store", "chemist",
)

# Sub-buildings of a campus. They should not inherit the campus bed count.
CAMPUS_SUBUNIT = (
    "postmortem", "post mortem", "dental", "pediatric division", "paediatric division",
    "emergency centre", "emergency center", "opd", "ward", "block", "annexe", "annex",
    "division", "department", "college of nursing", "hostel",
)


def is_receiving(tags):
    name = (tags.get("name") or "").lower()
    if any(w in name for w in NOT_A_RECEIVING_FACILITY):
        return False
    if tags.get("healthcare") in ("laboratory", "dentist", "blood_donation", "physiotherapist"):
        return False
    # A clinic can stabilise but is not an inpatient destination.
    return tags.get("amenity") == "hospital"


def capacity(tags, osm_id):
    """Simulated bed/staff counts, scaled by what the facility actually claims to be.

    A district hospital and a one-room clinic should not get the same distribution,
    so this reads the real OSM type tags to pick a plausible band. The band is
    honest about the facility class; the number inside it is invented.
    """
    name = (tags.get("name") or "").lower()
    amenity = tags.get("amenity")
    subunit = any(w in name for w in CAMPUS_SUBUNIT)

    tertiary = any(w in name for w in ("medical college", "gmch", "aiims", "pmch"))
    if tertiary and not subunit:
        band = (600, 1600)  # tertiary teaching hospital, whole campus
    elif tertiary and subunit:
        band = (10, 90)  # one building on that campus
    elif "civil hospital" in name or "district hospital" in name:
        band = (100, 300)
    elif amenity == "hospital" and not subunit:
        band = (20, 180)
    else:
        band = (0, 12)  # clinics and sub-units rarely hold inpatients

    total = stable_int(osm_id, "beds", *band)
    # Occupancy 55-95%: Indian public hospitals routinely run near or over capacity,
    # so a demo showing half-empty wards would be the unrealistic choice.
    occupied_pct = stable_int(osm_id, "occ", 55, 95)
    available = max(0, total - (total * occupied_pct // 100))
    doctors = max(0, stable_int(osm_id, "docs", 0, max(1, total // 12)))
    return total, available, doctors


def to_row(el):
    tags = el.get("tags") or {}
    name = tags.get("name")
    if not name:
        return None

    lat = el.get("lat") or (el.get("center") or {}).get("lat")
    lon = el.get("lon") or (el.get("center") or {}).get("lon")
    if lat is None or lon is None:
        return None

    osm_id = el["id"]
    total, available, doctors = capacity(tags, osm_id)

    emergency = tags.get("emergency")
    return {
        "osm_type": el["type"],
        "osm_id": osm_id,
        "name": name[:200],
        "amenity": tags.get("amenity"),
        "healthcare": tags.get("healthcare"),
        "speciality": tags.get("healthcare:speciality"),
        "operator_type": tags.get("operator:type"),
        "district": tags.get("addr:district"),
        "state": tags.get("addr:state"),
        "postcode": tags.get("addr:postcode"),
        "address": tags.get("addr:full") or tags.get("addr:street"),
        "phone": tags.get("contact:phone") or tags.get("phone"),
        "website": tags.get("website"),
        # Tri-state on purpose: absent in OSM is "unknown", not "no emergency dept".
        "emergency": True if emergency == "yes" else (False if emergency == "no" else None),
        "lat": round(float(lat), 6),
        "lon": round(float(lon), 6),
        "coord_source": "osm",
        "capacity_source": "simulated",
        "dispatch_eligible": is_receiving(tags),
        "beds_total": total,
        "beds_available": available,
        "doctors_on_duty": doctors,
    }


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: load_osm_facilities.py <overpass.json> [more.json ...]")

    env = load_env(ENV_PATH)
    url, key = env.get("SUPABASE_URL"), env.get("SUPABASE_SECRET_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL / SUPABASE_SECRET_KEY missing from backend/.env")

    rows, seen = [], set()
    for path in sys.argv[1:]:
        with open(path, encoding="utf-8") as fh:
            for el in json.load(fh)["elements"]:
                row = to_row(el)
                if not row:
                    continue
                pk = (row["osm_type"], row["osm_id"])
                if pk in seen:  # same object can appear in overlapping bboxes
                    continue
                seen.add(pk)
                rows.append(row)

    print(f"{len(rows)} facilities to upsert")

    req = urllib.request.Request(
        f"{url}/rest/v1/facilities?on_conflict=osm_type,osm_id",
        data=json.dumps(rows).encode("utf-8"),
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            # merge-duplicates makes a re-run an update, not a 409.
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        method="POST",
    )
    with urllib.request.urlopen(req) as res:
        print(f"HTTP {res.status} {res.reason}")


if __name__ == "__main__":
    main()
