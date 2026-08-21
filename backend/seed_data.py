"""Seed synthetic patient profiles into Supabase from CSV datasets."""

import csv
import os
import random
import sys
import uuid
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from supabase import create_client, Client

# ---------------------------------------------------------------------------
# Load environment
# ---------------------------------------------------------------------------
load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise EnvironmentError(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env"
    )

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# ---------------------------------------------------------------------------
# CSV path (relative to this file)
# ---------------------------------------------------------------------------
CSV_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "dataset",
    "PS-3-Use-case-database-1.csv",
)

# ---------------------------------------------------------------------------
# Synthetic name pools
# ---------------------------------------------------------------------------
MALE_FIRST = [
    "Aarav",
    "Vikram",
    "Rajesh",
    "Suresh",
    "Manish",
    "Amit",
    "Deepak",
    "Sanjay",
    "Rahul",
    "Rohit",
    "Nikhil",
    "Arjun",
    "Karan",
    "Pradeep",
    "Manoj",
]

FEMALE_FIRST = [
    "Priya",
    "Anjali",
    "Sunita",
    "Kavita",
    "Rekha",
    "Meena",
    "Geeta",
    "Anita",
    "Pooja",
    "Nisha",
    "Sneha",
    "Divya",
    "Ritu",
    "Lata",
    "Shanti",
]

LAST_NAMES = [
    "Sharma",
    "Verma",
    "Gupta",
    "Singh",
    "Kumar",
    "Yadav",
    "Mishra",
    "Pandey",
    "Jha",
    "Tiwari",
    "Chaudhary",
    "Srivastava",
    "Pathak",
    "Dubey",
    "Patel",
    "Shah",
    "Mehta",
    "Joshi",
    "Nair",
    "Iyer",
]

LANGUAGES = ["hindi", "bhojpuri", "maithili", "urdu", "hindi"]  # weighted toward hindi

# ---------------------------------------------------------------------------
# Camp name → camp_type mapping
# ---------------------------------------------------------------------------
CAMP_TYPE_MAP = {
    "Gandhi Maidan": "general",
    "Digha Slum": "slum",
    "Aashrya Old Age Home": "elderly",
    "Disha Deaddiction": "deaddiction",
}


def resolve_camp_type(health_camp_name: str) -> str:
    for keyword, camp_type in CAMP_TYPE_MAP.items():
        if keyword in health_camp_name:
            return camp_type
    return "general"


def clean_camp_name(health_camp_name: str) -> str:
    """Strip date suffixes like ' - 25-07-2025'."""
    if " - " in health_camp_name:
        return health_camp_name.split(" - ")[0].strip()
    return health_camp_name.strip()


# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------
def generate_name() -> tuple[str, str]:
    """Return (full_name, gender)."""
    gender = random.choice(["male", "female"])
    first = random.choice(MALE_FIRST if gender == "male" else FEMALE_FIRST)
    last = random.choice(LAST_NAMES)
    return f"{first} {last}", gender


def generate_abha_id() -> str:
    """Format: 91-XXXX-XXXX-XXXX (each X is a digit)."""
    parts = [str(random.randint(1000, 9999)) for _ in range(3)]
    return f"91-{'-'.join(parts)}"


def generate_phone() -> str:
    """Indian mobile: +91 followed by 10 digits starting with 6-9."""
    start = random.choice([6, 7, 8, 9])
    rest = "".join(str(random.randint(0, 9)) for _ in range(9))
    return f"+91{start}{rest}"


def safe_int(val: str) -> int | None:
    try:
        return int(float(val.strip())) if val.strip() else None
    except (ValueError, AttributeError):
        return None


def safe_float(val: str) -> float | None:
    try:
        return float(val.strip()) if val.strip() else None
    except (ValueError, AttributeError):
        return None


def safe_str(val: str) -> str | None:
    v = val.strip() if val else ""
    return v if v else None


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def random_past_dt(days_back: int = 270) -> str:
    """Random timestamp within the last `days_back` days."""
    delta = timedelta(
        days=random.randint(0, days_back),
        hours=random.randint(0, 23),
        minutes=random.randint(0, 59),
    )
    dt = datetime.now(timezone.utc) - delta
    return dt.isoformat()


# ---------------------------------------------------------------------------
# Synthetic doctors (inserted first, IDs reused for assigned_doctor_id)
# ---------------------------------------------------------------------------
DOCTORS = [
    {
        "id": str(uuid.uuid4()),
        "name": "Dr. Arun Mehta",
        "email": "arun.mehta@swadhikaar.health",
        "specialization": "General Physician",
        "phone": generate_phone(),
    },
    {
        "id": str(uuid.uuid4()),
        "name": "Dr. Sunita Rao",
        "email": "sunita.rao@swadhikaar.health",
        "specialization": "Cardiologist",
        "phone": generate_phone(),
    },
    {
        "id": str(uuid.uuid4()),
        "name": "Dr. Pradeep Jha",
        "email": "pradeep.jha@swadhikaar.health",
        "specialization": "Diabetologist",
        "phone": generate_phone(),
    },
]


# ---------------------------------------------------------------------------
# Seed doctors into the `doctors` table (if it exists)
# ---------------------------------------------------------------------------
def seed_doctors() -> list[str]:
    """Insert synthetic doctors and return their UUIDs."""
    doctor_ids = []
    print("\n--- Seeding doctors ---")
    for doc in DOCTORS:
        doc_id = doc["id"]
        try:
            supabase.table("doctors").upsert(
                {
                    "id": doc_id,
                    "name": doc["name"],
                    "email": doc["email"],
                    "specialization": doc["specialization"],
                    "phone": doc["phone"],
                    "created_at": now_utc(),
                },
                on_conflict="id",
            ).execute()
            print(f"  [OK] Doctor: {doc['name']} ({doc_id})")
            doctor_ids.append(doc_id)
        except Exception as e:
            # Table may not exist yet — still return IDs for FK usage
            print(f"  [WARN] Could not insert doctor {doc['name']}: {e}")
            doctor_ids.append(doc_id)
    return doctor_ids


# ---------------------------------------------------------------------------
# Main seed function
# ---------------------------------------------------------------------------
def seed():
    print("=" * 60)
    print("Swadhikaar — Supabase Seed Script")
    print("=" * 60)

    # 1. Seed doctors
    doctor_ids = seed_doctors()

    # 2. Read CSV
    if not os.path.exists(CSV_PATH):
        raise FileNotFoundError(f"CSV not found at: {CSV_PATH}")

    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"\nCSV loaded: {len(rows)} rows")

    # 3. Generate and insert one patient per row
    inserted_patients = 0
    inserted_vitals = 0
    inserted_risks = 0
    inserted_symptoms = 0
    inserted_consents = 0

    for idx, row in enumerate(rows, start=1):
        try:
            # --- Patient ---
            patient_id = str(uuid.uuid4())
            name, gender = generate_name()
            abha_id = generate_abha_id()
            phone = generate_phone()
            language = random.choice(LANGUAGES)
            camp_raw = row.get("health_camp_name", "").strip()
            health_camp = clean_camp_name(camp_raw)
            camp_type = resolve_camp_type(camp_raw)
            risk_level = safe_str(row.get("overall_risk_category", "")) or "Unknown"
            overall_risk_score = safe_float(row.get("overall_risk_score", ""))
            assigned_doctor_id = random.choice(doctor_ids)

            patient_record = {
                "id": patient_id,
                "abha_id": abha_id,
                "name": name,
                "phone": phone,
                "language": language,
                "health_camp": health_camp,
                "camp_type": camp_type,
                "risk_level": risk_level,
                "overall_risk_score": overall_risk_score,
                "consent_status": random.choice(
                    ["pending", "granted", "granted", "granted"]
                ),
                "assigned_doctor_id": assigned_doctor_id,
            }

            supabase.table("patients").insert(patient_record).execute()
            inserted_patients += 1

            # --- Health Vitals ---
            recorded_at = safe_str(row.get("updated_at", "")) or random_past_dt()
            vitals_record = {
                "id": str(uuid.uuid4()),
                "patient_id": patient_id,
                "systolic_bp": safe_int(row.get("systolic_bp", "")),
                "diastolic_bp": safe_int(row.get("diastolic_bp", "")),
                "heart_rate": safe_int(row.get("heart_rate", "")),
                "respiratory_rate": safe_int(row.get("respiratory_rate", "")),
                "oxygen_saturation": safe_int(row.get("oxygen_saturation", "")),
                "temperature": safe_float(row.get("temperature", "")),
                "blood_glucose": safe_int(row.get("blood_glucose", "")),
                "height": safe_float(row.get("height", "")),
                "weight": safe_float(row.get("weight", "")),
                "bmi": safe_float(row.get("bmi", "")),
                "bmi_category": safe_str(row.get("bmi_category", "")),
                "waist_circumference": safe_float(row.get("waist_circumference", "")),
                "waist_to_height_ratio": safe_float(
                    row.get("waist_to_height_ratio", "")
                ),
                "perfusion_index": safe_float(row.get("perfusion_index", "")),
                "recorded_at": recorded_at,
            }
            supabase.table("health_vitals").insert(vitals_record).execute()
            inserted_vitals += 1

            # --- Risk Assessment ---
            risk_record = {
                "id": str(uuid.uuid4()),
                "patient_id": patient_id,
                "heart_risk_score": safe_float(row.get("heart_risk_total_score", "")),
                "heart_risk_level": safe_str(row.get("heart_risk_level", "")),
                "diabetic_risk_score": safe_float(
                    row.get("diabetic_risk_total_score", "")
                ),
                "diabetic_risk_level": safe_str(row.get("diabetic_risk_level", "")),
                "hypertension_risk_score": safe_float(
                    row.get("hypertension_risk_total_score", "")
                ),
                "hypertension_risk_level": safe_str(
                    row.get("hypertension_risk_level", "")
                ),
                "overall_risk_category": safe_str(row.get("overall_risk_category", "")),
                "overall_risk_score": overall_risk_score,
                "assessed_at": recorded_at,
            }
            supabase.table("risk_assessments").insert(risk_record).execute()
            inserted_risks += 1

            # --- Symptoms ---
            symptoms_record = {
                "id": str(uuid.uuid4()),
                "patient_id": patient_id,
                "chest_discomfort": safe_str(row.get("chest_discomfort", "")),
                "breathlessness": safe_str(row.get("breathlessness", "")),
                "palpitations": safe_str(row.get("palpitations", "")),
                "fatigue_weakness": safe_str(row.get("fatigue_weakness", "")),
                "dizziness_blackouts": safe_str(row.get("dizziness_blackouts", "")),
                "sleep_duration": safe_str(row.get("sleep_duration", "")),
                "stress_anxiety": safe_str(row.get("stress_anxiety", "")),
                "physical_inactivity": safe_str(row.get("physical_inactivity", "")),
                "diet_quality": safe_str(row.get("diet_quality", "")),
                "family_history": safe_str(row.get("family_history", "")),
                "recorded_at": recorded_at,
            }
            supabase.table("symptoms").insert(symptoms_record).execute()
            inserted_symptoms += 1

            # --- Consent records (DPDP Act) ---
            consent_status = patient_record["consent_status"]
            is_granted = consent_status == "granted"
            consent_purposes = [
                ("health_followup", "voice_calls"),
                ("data_sharing", "doctor_sharing"),
                ("data_collection", "health_records"),
            ]
            for purpose, scope in consent_purposes:
                consent_record = {
                    "id": str(uuid.uuid4()),
                    "patient_id": patient_id,
                    "purpose": purpose,
                    "scope": scope,
                    "consent_mode": random.choice(["verbal", "verbal", "written"]),
                    "granted_at": recorded_at if is_granted else None,
                    "revoked_at": None,
                    "is_active": is_granted,
                }
                try:
                    supabase.table("consents").insert(consent_record).execute()
                    inserted_consents += 1
                except Exception as e:
                    pass  # non-fatal

            print(
                f"  [{idx:03d}/{len(rows)}] {name} | {camp_type:12s} | "
                f"Risk: {risk_level:8s} | Score: {overall_risk_score}"
            )

        except Exception as e:
            print(f"  [ERROR] Row {idx}: {e}")
            continue

    # ---------------------------------------------------------------------------
    # Summary
    # ---------------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("Seed complete.")
    print(f"  Patients inserted   : {inserted_patients}")
    print(f"  Vitals inserted     : {inserted_vitals}")
    print(f"  Risk assessments    : {inserted_risks}")
    print(f"  Symptoms inserted   : {inserted_symptoms}")
    print(f"  Consent records     : {inserted_consents}")
    print("=" * 60)


def seed_escalations(limit: int = 3) -> None:
    """Demo fixture: a few voice calls with escalations hung off seeded patients."""
    res = supabase.table("patients").select("id").limit(limit).execute()
    if not res.data:
        print("No patients found — run the patient seed first.")
        return

    print("Inserting voice calls and escalations...")
    for i, p_id in enumerate(p["id"] for p in res.data):
        call_id = str(uuid.uuid4())
        started = datetime.now(timezone.utc) - timedelta(minutes=i * 30 + 10)
        supabase.table("voice_calls").insert(
            {
                "id": call_id,
                "patient_id": p_id,
                "call_type": "follow_up",
                "use_case": "follow_up",
                "status": "completed",
                "language": "hindi",
                "transcript": (
                    "Mera blood pressure badha hua lag raha hai aur chakkar aa raha hai."
                ),
                "severity": "HIGH" if i == 0 else "MODERATE",
                "duration_seconds": 120,
                "started_at": started.isoformat(),
                "ended_at": (started + timedelta(minutes=2)).isoformat(),
            }
        ).execute()

        if i < 2:
            supabase.table("escalations").insert(
                {
                    "id": str(uuid.uuid4()),
                    "patient_id": p_id,
                    "call_id": call_id,
                    "severity_level": "3" if i == 0 else "2",
                    "severity": "CRITICAL" if i == 0 else "HIGH",
                    "reason": (
                        "High blood pressure symptoms reported during voice AI checkin."
                    ),
                    "status": "open",
                }
            ).execute()
    print("Done.")


if __name__ == "__main__":
    if "--escalations" in sys.argv:
        seed_escalations()
    else:
        seed()
