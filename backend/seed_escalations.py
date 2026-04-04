import os
import uuid
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

# Get some patient IDs
res = supabase.table("patients").select("id").limit(3).execute()
if not res.data:
    print("No patients found")
    exit(1)

patients = [p["id"] for p in res.data]

print("Inserting voice calls and escalations...")

for i, p_id in enumerate(patients):
    call_id = str(uuid.uuid4())
    call_record = {
        "id": call_id,
        "patient_id": p_id,
        "call_type": "follow_up",
        "use_case": "follow_up",
        "status": "completed",
        "language": "hindi",
        "transcript": "Mera blood pressure badha hua lag raha hai aur chakkar aa raha hai.",
        "extracted_data": {"symptoms": ["headache", "dizziness"], "overall_severity": "HIGH"},
        "severity": "HIGH" if i == 0 else "MODERATE",
        "duration_seconds": 120,
        "started_at": (datetime.now(timezone.utc) - timedelta(minutes=i*30 + 10)).isoformat(),
        "ended_at": (datetime.now(timezone.utc) - timedelta(minutes=i*30 + 8)).isoformat(),
    }
    supabase.table("voice_calls").insert(call_record).execute()

    if i < 2:
        esc_record = {
            "id": str(uuid.uuid4()),
            "patient_id": p_id,
            "call_id": call_id,
            "severity_level": "3" if i == 0 else "2",
            "severity": "CRITICAL" if i == 0 else "HIGH",
            "reason": "High blood pressure symptoms reported during voice AI checkin.",
            "status": "open",
        }
        supabase.table("escalations").insert(esc_record).execute()

print("Done.")
