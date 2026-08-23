"""
Swadhikaar Voice AI Agent.

Supports a single runtime path:
  - fast: Deepgram STT + Groq (Gemini fallback) + provider-selectable TTS

Architecture:
  - Room metadata carries patient context from Supabase Edge Functions
  - Agent handles multilingual conversation, triage, and escalation signals
  - Transcript + extraction payloads are persisted to Supabase after call end

Run locally:
    python agent.py dev

Run as worker (production):
    python agent.py start

Required environment variables (see .env.example):
    LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
    SUPABASE_URL, SUPABASE_KEY
    GOOGLE_API_KEY
    DEEPGRAM_API_KEY
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from typing import Annotated, Any, Callable, Optional

from pydantic import Field

from dotenv import load_dotenv

from livekit.agents import (
    AgentSession,
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    llm,
    tts as lk_tts,
)
from livekit.agents.voice import Agent as VoiceAgent
from livekit.plugins import google as google_plugin
from livekit.plugins import deepgram as deepgram_plugin
from livekit.plugins import openai as openai_plugin
from livekit.plugins import silero as silero_plugin

try:
    from livekit.plugins import cartesia as cartesia_plugin
except Exception:  # pragma: no cover
    cartesia_plugin = None

try:
    from livekit.plugins import sarvam as sarvam_plugin
except Exception:  # pragma: no cover
    sarvam_plugin = None

try:
    from livekit.plugins import murf as murf_plugin
except Exception:  # pragma: no cover
    murf_plugin = None

if sarvam_plugin is not None:

    class ReliableSarvamTTS(sarvam_plugin.TTS):
        """Force non-streaming mode to avoid WAV decode failures in current stack."""

        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self._capabilities = lk_tts.TTSCapabilities(streaming=False)
else:
    ReliableSarvamTTS = None


# Local imports
from prompts.system_prompts import build_system_prompt, DEFAULT_CONTEXT

load_dotenv()

logger = logging.getLogger("swadhikaar.agent")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Languages → BCP-47 codes for Google STT/TTS
LANGUAGE_CODES: dict[str, str] = {
    "hindi": "hi-IN",
    "english": "en-IN",
    "bengali": "bn-IN",
    "tamil": "ta-IN",
    "telugu": "te-IN",
    "marathi": "mr-IN",
    "gujarati": "gu-IN",
    "kannada": "kn-IN",
    "malayalam": "ml-IN",
    "punjabi": "pa-IN",
    # Dialects — fall back to Hindi for STT accuracy
    "bhojpuri": "hi-IN",
    "maithili": "hi-IN",
}

# Call type → friendly greeting text (Hindi)
GREETINGS: dict[str, str] = {
    "screening_to_opd": (
        "Namaste {name} ji! Yeh Swadhikaar ki taraf se call hai. "
        "Aapka health camp mein screening hua tha. "
        "Hum jaanna chahte hain ki aap ab kaisa feel kar rahe hain?"
    ),
    "opd_to_ipd": (
        "Namaste {name} ji! Swadhikaar se call aa rahi hai. "
        "Aap OPD mein doctor se mile the — aap abhi kaisa mahsoos kar rahe hain?"
    ),
    "recovery_protocol": (
        "Namaste {name} ji! Aap hospital se ghar aaye hain — kaisi recovery chal rahi hai? "
        "Hum Swadhikaar se aapka haal lene ke liye call kar rahe hain."
    ),
    "chronic_management": (
        "Namaste {name} ji! Yeh aapka daily health check-in call hai Swadhikaar se. "
        "Aaj aap kaisa feel kar rahe hain?"
    ),
    "follow_up": (
        "Namaste {name} ji! Yeh Swadhikaar se call hai. "
        "Aapka haal-chaal jaanna chahte hain. Aap kaise hain?"
    ),
    "elderly_checkin": (
        "Namaste {name} ji! Swadhikaar ki taraf se aapka weekly check-in call hai. "
        "Aap kaisa feel kar rahe hain aaj?"
    ),
    "newborn_vaccination": (
        "Namaste {name} ji! Yeh Swadhikaar se call hai. "
        "Aapke bachche ka teekakaran ka samay aa raha hai. "
        "Hum aapko yaad dilana chahte hain."
    ),
}

# CRITICAL trigger keywords — for real-time escalation detection (patient speech)
_CRITICAL_KEYWORDS_HI = [
    # Chest / cardiac
    "seene mein dard",
    "chest pain",
    "chest mein dard",
    "dil mein dard",
    "heart attack",
    "dil ka daura",
    # Breathing
    "saans nahi",
    "saans nahi aa rahi",
    "breathlessness",
    "breathless",
    "saans lene mein",
    "dum ghut",
    # Consciousness
    "behosh",
    "behosh ho gaya",
    "unconscious",
    "faint",
    "hosh nahi",
    # Neurological
    "laqwa",
    "paralysis",
    "muh tedha",
    "stroke",
    "lakwa",
    "sar mein bahut tej dard",
    "sudden headache",
    # Bleeding
    "khoon aa raha hai",
    "bleeding",
    "bahut khoon",
    "haemorrhage",
    # Glucose / BP extremes
    "sugar bahut kam",
    "sugar gir gayi",
    "glucose low",
    "bp bahut zyada",
    "bp 180",
    "bp 200",
    # Seizures / convulsions
    "mirgi",
    "seizure",
    "jhatkay",
    "convulsion",
    # Pregnancy emergencies
    "pet mein bahut dard",
    "bleeding ho rahi",
    "pani aa raha",
]

# HIGH trigger keywords — for elevated risk detection (patient speech)
_HIGH_KEYWORDS_HI = [
    # Medication non-adherence
    "dawai nahi",
    "dawai band",
    "dawai bhool",
    "medicine nahi",
    "goli nahi khai",
    "tablet band",
    "missed medication",
    # Persistent symptoms
    "bukhar",
    "fever",
    "tez bukhar",
    "5 din se bukhar",
    "sir dard",
    "headache",
    "persistent headache",
    "dhundla",
    "blurred vision",
    "nazar kamzor",
    # Infection signs
    "infection",
    "sujan",
    "pus",
    "wound",
    "ghav",
    "zakhm",
    "ghav mein sujan",
    "wound infection",
    # Mental state
    "confused",
    "confused lag raha",
    "samajh nahi aa raha",
    "yaad nahi",
    "bhool jaata",
    # Pain
    "bahut dard",
    "dard bahut",
    "severe pain",
    "asahniya dard",
    # Falls / mobility
    "gir gayi",
    "gir gaya",
    "fall",
    "girna",
    "chal nahi pa raha",
    # Vitals
    "bp high",
    "high bp",
    "sugar high",
    "sugar bahut",
    "weight badh",
    "weight kam",
    "kamzori",
    "weakness",
    # General distress
    "bahut kharab",
    "bahut bura",
    "theek nahi",
    "tabiyat kharab",
    "chakkar",
    "dizziness",
    "ulti",
    "vomiting",
    "dast",
    "diarrhea",
]

# Agent-side escalation indicators — when the agent itself tells the patient
# to seek emergency help, that IS the escalation signal
_AGENT_CRITICAL_INDICATORS = [
    "108 call",
    "108 pe call",
    "ambulance",
    "turant hospital",
    "abhi hospital",
    "emergency",
    "abhi doctor",
    "turant doctor",
    "jaan ka khatra",
    "life threatening",
]

_AGENT_HIGH_INDICATORS = [
    "doctor se milna chahiye",
    "doctor ko dikhayein",
    "opd mein aayein",
    "hospital aayein",
    "check-up karwayein",
    "dawai zaroor",
    "dawai band mat",
    "medicine continue",
    "test karwayein",
    "blood test",
    "jaanch karwayein",
]


# ---------------------------------------------------------------------------
# Supabase helper
# ---------------------------------------------------------------------------

_supabase_client = None  # Module-level cached client

# Checked in order. SUPABASE_KEY is listed last because .env.example ships it as
# the literal placeholder "your-service-role-key", and for the whole project so far
# it stayed that way — so every call persisted nothing and logged one 401 line
# nobody read. A placeholder must never look like a configured key.
_SUPABASE_KEY_VARS = (
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_KEY",
)


def _supabase_key() -> tuple[str, str]:
    """Return (var_name, key), skipping unset and placeholder values."""
    for name in _SUPABASE_KEY_VARS:
        v = os.getenv(name, "").strip()
        if v and not v.startswith("your-"):
            return name, v
    return "", ""


def _get_supabase_client():
    """Return a cached Supabase client. Creates one on first call."""
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client
    url = os.getenv("SUPABASE_URL", "")
    var, key = _supabase_key()
    if not url or not key:
        # Loud, because the failure is otherwise invisible: calls connect, the
        # patient is spoken to, and the transcript, severity and escalation are
        # all dropped on the floor.
        logger.error(
            "NO SUPABASE CREDENTIALS — transcripts, escalations and journey "
            "updates will be LOST. Set one of %s in backend/.env.",
            ", ".join(_SUPABASE_KEY_VARS),
        )
        return None
    try:
        from supabase import create_client

        _supabase_client = create_client(url, key)
        logger.info("Supabase client ready (via %s)", var)
        return _supabase_client
    except Exception as exc:
        logger.error("Failed to create Supabase client: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Transcript accumulator
# ---------------------------------------------------------------------------


class TranscriptAccumulator:
    """
    Collects utterances during a call and detects escalation signals
    from both patient speech (symptoms) and agent speech (clinical advice).
    """

    def __init__(self, on_severity: Callable[[str], None] | None = None) -> None:
        self.turns: list[dict[str, str]] = []
        self._escalation_triggered = False
        self._high_triggered = False
        # Fired once, the moment a severity keyword first appears — the safety
        # net for when the LLM never calls the escalate_patient tool.
        self._on_severity = on_severity
        self._notified = False

    def add(self, role: str, text: str) -> None:
        self.turns.append(
            {
                "role": role,
                "text": text,
                "ts": datetime.now(timezone.utc).isoformat(),
            }
        )
        lower = text.lower()

        if role == "user":
            # Scan patient speech for critical symptoms
            if not self._escalation_triggered:
                if any(kw in lower for kw in _CRITICAL_KEYWORDS_HI):
                    logger.warning("CRITICAL keyword in patient speech: %s", text[:120])
                    self._escalation_triggered = True
            # Scan for high-severity indicators
            if not self._high_triggered and not self._escalation_triggered:
                if any(kw in lower for kw in _HIGH_KEYWORDS_HI):
                    logger.warning("HIGH keyword in patient speech: %s", text[:120])
                    self._high_triggered = True

        elif role == "assistant":
            # Scan agent speech — if the agent tells patient to call 108
            # or go to hospital, that IS the escalation
            if not self._escalation_triggered:
                if any(kw in lower for kw in _AGENT_CRITICAL_INDICATORS):
                    logger.warning("Agent issued CRITICAL advice: %s", text[:120])
                    self._escalation_triggered = True
            if not self._high_triggered and not self._escalation_triggered:
                if any(kw in lower for kw in _AGENT_HIGH_INDICATORS):
                    logger.info("Agent issued HIGH-level advice: %s", text[:120])
                    self._high_triggered = True

        if self._on_severity and not self._notified:
            if self._escalation_triggered or self._high_triggered:
                self._notified = True
                self._on_severity(
                    "CRITICAL" if self._escalation_triggered else "HIGH"
                )

    @property
    def is_critical(self) -> bool:
        return self._escalation_triggered

    @property
    def is_high(self) -> bool:
        return self._high_triggered

    def to_plain_text(self) -> str:
        lines = []
        for turn in self.turns:
            prefix = "Patient" if turn["role"] == "user" else "Agent"
            lines.append(f"[{turn['ts']}] {prefix}: {turn['text']}")
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Persist call data to Supabase
# ---------------------------------------------------------------------------


async def _persist_call_data(
    patient_id: str,
    call_type: str,
    language: str,
    transcript: TranscriptAccumulator,
    realtime_actions: set[str] | None = None,
) -> None:
    """Write transcript + detected severity to Supabase `voice_calls` table.

    Args:
        realtime_actions: Set of actions already taken by tools during the call
                          (e.g. "escalation", "risk_update", "journey_update").
                          These will be skipped to avoid duplication.
    """
    if realtime_actions is None:
        realtime_actions = set()
    supabase = _get_supabase_client()
    if supabase is None:
        logger.info("Skipping Supabase persist (no client).")
        return

    # Severity comes from keyword + agent-advice detection over the transcript.
    needs_escalation = transcript.is_critical or transcript.is_high
    if transcript.is_critical:
        severity = "CRITICAL"
    elif transcript.is_high:
        severity = "HIGH"
    elif transcript.turns:
        severity = "LOW"
    else:
        severity = "UNKNOWN"

    # Skip persistence for placeholder/non-UUID patient identifiers
    uuid_like = re.compile(
        r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
    )
    if not uuid_like.match(patient_id):
        logger.warning("Skipping DB insert for non-UUID patient_id: %s", patient_id)
        return

    record = {
        "patient_id": patient_id,
        "call_type": call_type,
        "use_case": call_type,
        "status": "completed" if transcript.turns else "ended",
        "language": language,
        "transcript": transcript.to_plain_text(),
        "severity": severity,
        "duration_seconds": max(1, len(transcript.turns) * 5),  # rough estimate
        "started_at": datetime.now(timezone.utc).isoformat(),
        "ended_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        result = supabase.table("voice_calls").insert(record).execute()
        call_id = result.data[0].get("id") if result.data else None
        logger.info("Call log persisted: %s (severity=%s)", call_id, severity)

        # If escalation needed, also write to escalations table
        # Skip if already done by escalate_patient tool during the call
        if needs_escalation and "escalation" not in realtime_actions:
            triage_record = {
                "patient_id": patient_id,
                "call_id": call_id,
                "severity_level": "3"
                if severity == "CRITICAL"
                else "2"
                if severity == "HIGH"
                else "1",
                "severity": severity,
                "reason": "Critical symptoms detected during call",
                "status": "open",
            }
            supabase.table("escalations").insert(triage_record).execute()
            logger.warning(
                "ESCALATION created for patient %s — severity=%s", patient_id, severity
            )

        # Auto-progress patient journey status based on call type
        # Skip if already done by update_journey_status tool during the call
        _JOURNEY_PROGRESSION = {
            "screening_to_opd": "opd_referred",
            "opd_to_ipd": "ipd_admitted",
            "recovery_protocol": "recovery",
            "chronic_management": "chronic_management",
            "follow_up": "follow_up_active",
            "newborn_vaccination": None,
        }
        next_status = _JOURNEY_PROGRESSION.get(call_type)
        if next_status and "journey_update" not in realtime_actions:
            try:
                supabase.table("patients").update({"journey_status": next_status}).eq(
                    "id", patient_id
                ).execute()
                logger.info("Journey updated: %s → %s", patient_id[:8], next_status)
            except Exception as exc:
                logger.error("Journey update failed: %s", exc)

        # Update patient risk level when severity is HIGH or CRITICAL
        # Skip for vaccination calls — parent's risk shouldn't change from a vaccine reminder
        # Skip if already done by update_risk_level tool during the call
        _SEVERITY_TO_RISK = {
            "CRITICAL": ("High", 90),
            "HIGH": ("High", 75),
            "MODERATE": ("Moderate", 50),
        }
        if (
            severity in _SEVERITY_TO_RISK
            and call_type != "newborn_vaccination"
            and "risk_update" not in realtime_actions
        ):
            risk_label, risk_score = _SEVERITY_TO_RISK[severity]
            try:
                supabase.table("patients").update(
                    {
                        "risk_level": risk_label,
                        "overall_risk_score": risk_score,
                    }
                ).eq("id", patient_id).execute()
                logger.info(
                    "Risk updated: %s → %s (score=%d)",
                    patient_id[:8],
                    risk_label,
                    risk_score,
                )
            except Exception as exc:
                logger.error("Risk update failed: %s", exc)

    except Exception as exc:
        logger.error("Supabase persist failed: %s", exc)


# ---------------------------------------------------------------------------
# Swadhikaar Voice Agent
# ---------------------------------------------------------------------------


class SwadhikaarAgent(VoiceAgent):
    """Voice agent that reads patient context from LiveKit room metadata."""

    def __init__(self) -> None:
        super().__init__(
            instructions=(
                "Aap Swadhikaar ki taraf se ek compassionate Hindi-speaking health "
                "assistant hain. Aap patients ko phone karke unka haal-chaal poochte hain. "
                "Apne system prompt ke update hone ka intezaar karein, phir baat shuru karein."
            ),
        )
        self._realtime_actions: set[str] = (
            set()
        )  # Track tool actions to avoid post-call duplication

    async def on_enter(self) -> None:
        """Called when the agent joins a room. Set up patient context and start conversation."""
        room = self.session.room_io.room
        logger.info("Agent joining room: %s", room.name)

        # Parse patient context from room metadata
        try:
            metadata: dict[str, Any] = json.loads(room.metadata or "{}")
        except json.JSONDecodeError:
            logger.warning("Invalid room metadata JSON — using defaults.")
            metadata = {}

        patient_id: str = metadata.get("patient_id", "unknown")
        patient_name: str = metadata.get("patient_name", "Patient")
        call_type: str = metadata.get("call_type", "follow_up")
        language: str = metadata.get("language", "hindi").lower()

        patient_context: dict[str, str] = {
            **DEFAULT_CONTEXT,
            "patient_name": patient_name,
            "age": str(metadata.get("age", "N/A")),
            "gender": metadata.get("gender", "N/A"),
            "health_camp": metadata.get("health_camp", "N/A"),
            "risk_level": metadata.get("risk_level", "Unknown"),
            "risk_score": str(metadata.get("risk_score", "N/A")),
            "systolic": str(metadata.get("systolic_bp", "N/A")),
            "diastolic": str(metadata.get("diastolic_bp", "N/A")),
            "glucose": str(metadata.get("blood_glucose", "N/A")),
            "bmi": str(metadata.get("bmi", "N/A")),
            "heart_rate": str(metadata.get("heart_rate", "N/A")),
            "oxygen_saturation": str(metadata.get("oxygen_saturation", "N/A")),
            "primary_condition": metadata.get("primary_condition", "N/A"),
            "medications": metadata.get("medications", "N/A"),
            "discharge_date": metadata.get("discharge_date", "N/A"),
            "doctor_name": metadata.get("doctor_name", "your doctor"),
            # Enriched clinical context from Supabase
            "active_symptoms": metadata.get("active_symptoms", "None reported"),
            "heart_risk": metadata.get("heart_risk", "N/A"),
            "diabetic_risk": metadata.get("diabetic_risk", "N/A"),
            "hypertension_risk": metadata.get("hypertension_risk", "N/A"),
            "family_history": metadata.get("family_history", "N/A"),
            "call_history": metadata.get("call_history", "No previous calls"),
            "total_previous_calls": metadata.get("total_previous_calls", "0"),
            # Vaccination-specific context (enriched from newborns table)
            "baby_name": metadata.get("baby_name", "Baby"),
            "baby_age": metadata.get("baby_age", "N/A"),
            "baby_gender": metadata.get("baby_gender", "N/A"),
            "next_vaccine": metadata.get("next_vaccine", "N/A"),
            "vaccine_due_date": metadata.get("vaccine_due_date", "N/A"),
            "vaccine_dose": metadata.get("vaccine_dose", "1"),
            "birth_hospital": metadata.get("birth_hospital", "N/A"),
        }

        logger.info(
            "Patient context: id=%s name=%s call_type=%s lang=%s risk=%s",
            patient_id,
            patient_name,
            call_type,
            language,
            patient_context["risk_level"],
        )

        # Build system prompt (conversation-only, no extraction schema)
        system_prompt = build_system_prompt(call_type, patient_context)
        await self.update_instructions(system_prompt)

        # Store context for later use
        self._patient_id = patient_id
        self._patient_name = patient_name
        self._call_type = call_type
        self._language = language
        self._transcript = TranscriptAccumulator(
            on_severity=self._on_severity_detected
        )

        # Trigger the agent to speak first using generate_reply().
        # We wrap this in a delayed task because Gemini Realtime API is in preview
        # and its WebSocket can take a long time to connect on the first turn,
        # which causes timeouts.
        greeting_template = GREETINGS.get(call_type, GREETINGS["follow_up"])
        greeting = greeting_template.format(name=patient_name)

        async def delayed_greeting():
            # In FAST pipeline keep this near-immediate; in LIVE give model time to settle.
            await asyncio.sleep(0.8)
            try:
                await self.session.generate_reply(
                    instructions=f'Baat shuru karo. Pehle yeh greeting bolo: "{greeting}" — phir patient ka jawab suno.'
                )
            except Exception as e:
                logger.error("Initial greeting failed due to Gemini timeout: %s", e)
                # If it times out, the model usually recovers on the next user speech turn

        asyncio.create_task(delayed_greeting())

        logger.info(
            "Agent started — room=%s patient=%s call_type=%s",
            room.name,
            patient_name,
            call_type,
        )

    # -----------------------------------------------------------------------
    # Escalation safety net — fired at keyword-detection time, not polled
    # -----------------------------------------------------------------------

    _MONITOR_ESCALATION = {
        "CRITICAL": ("3", 90, "Critical symptoms detected by keyword monitor during call"),
        "HIGH": ("2", 75, "High-severity symptoms detected by keyword monitor during call"),
    }

    def _on_severity_detected(self, severity: str) -> None:
        """Sync hook from TranscriptAccumulator.add() — schedules the insert.

        This is the safety net for when the LLM never calls escalate_patient
        (model failure, hallucination, or a mid-sentence language switch).
        """
        if getattr(self, "_closing", False):
            return
        # Skip if the escalate_patient tool already handled it
        if "escalation" in self._realtime_actions:
            return
        # Vaccination calls: the parent's phrasing shouldn't auto-escalate
        if getattr(self, "_call_type", "") == "newborn_vaccination":
            return
        patient_id = getattr(self, "_patient_id", "")
        if not patient_id or patient_id == "unknown":
            return
        asyncio.create_task(self._insert_monitor_escalation(severity, patient_id))

    async def _insert_monitor_escalation(self, severity: str, patient_id: str) -> None:
        level, score, reason = self._MONITOR_ESCALATION[severity]
        logger.warning(
            "MONITOR: %s keyword detected for patient %s - creating escalation",
            severity,
            patient_id[:8],
        )
        try:
            sb = _get_supabase_client()
            if sb is None:
                return
            sb.table("escalations").insert(
                {
                    "patient_id": patient_id,
                    "severity_level": level,
                    "severity": severity,
                    "reason": reason,
                    "status": "open",
                }
            ).execute()
            sb.table("patients").update(
                {"risk_level": "High", "overall_risk_score": score}
            ).eq("id", patient_id).execute()
            self._realtime_actions.add("escalation")
            self._realtime_actions.add("risk_update")
            logger.warning(
                "MONITOR: %s escalation + risk update created for %s",
                severity,
                patient_id[:8],
            )
        except Exception as exc:
            logger.error("MONITOR: %s escalation insert failed: %s", severity, exc)

    # -----------------------------------------------------------------------
    # Real-time function tools — Gemini calls these mid-conversation
    # -----------------------------------------------------------------------

    @llm.function_tool
    async def escalate_patient(
        self,
        severity: Annotated[str, Field(description="Severity level: CRITICAL or HIGH")],
        reason: Annotated[
            str, Field(description="Brief reason for the escalation in English")
        ],
    ) -> str:
        """Create an immediate escalation when patient reports dangerous symptoms.
        Call for CRITICAL: chest pain, breathlessness, unconsciousness, paralysis, stroke, severe bleeding, seizure.
        Call for HIGH: missed medications >3 days, persistent fever >5 days, wound infection, confusion, severe pain."""
        if not hasattr(self, "_patient_id"):
            return "Cannot escalate — patient context not loaded yet."

        sb = _get_supabase_client()
        if not sb:
            return "Escalation noted but database unavailable."

        severity_upper = severity.upper()
        if severity_upper not in ("CRITICAL", "HIGH"):
            severity_upper = "HIGH"

        try:
            sb.table("escalations").insert(
                {
                    "patient_id": self._patient_id,
                    "severity_level": "3" if severity_upper == "CRITICAL" else "2",
                    "severity": severity_upper,
                    "reason": reason,
                    "status": "open",
                }
            ).execute()
            self._realtime_actions.add("escalation")
            logger.warning(
                "REAL-TIME ESCALATION: patient=%s severity=%s reason=%s",
                self._patient_id[:8],
                severity_upper,
                reason,
            )
            return f"Escalation created: {severity_upper}. Doctor will be notified immediately."
        except Exception as exc:
            logger.error("Tool escalate_patient failed: %s", exc)
            return "Escalation attempt failed — will retry at call end."

    @llm.function_tool
    async def update_risk_level(
        self,
        new_level: Annotated[
            str, Field(description="New risk level: High, Moderate, or Low")
        ],
        reason: Annotated[
            str, Field(description="Why the risk level changed based on conversation")
        ],
    ) -> str:
        """Update patient risk level when conversation reveals condition change.
        Increase to High: new dangerous symptoms, worsening condition, missed medications.
        Decrease to Low: consistent improvement, medication adherence, stable vitals."""
        if not hasattr(self, "_patient_id"):
            return "Cannot update — patient context not loaded."

        sb = _get_supabase_client()
        if not sb:
            return "Risk noted but database unavailable."

        level = new_level.capitalize()
        score_map = {"High": 80, "Moderate": 50, "Low": 20}
        score = score_map.get(level, 50)

        try:
            sb.table("patients").update(
                {
                    "risk_level": level,
                    "overall_risk_score": score,
                }
            ).eq("id", self._patient_id).execute()
            self._realtime_actions.add("risk_update")
            logger.info(
                "REAL-TIME RISK UPDATE: patient=%s → %s (score=%d)",
                self._patient_id[:8],
                level,
                score,
            )
            return f"Risk level updated to {level}."
        except Exception as exc:
            logger.error("Tool update_risk_level failed: %s", exc)
            return "Risk update failed — will retry at call end."

    @llm.function_tool
    async def update_journey_status(
        self,
        new_status: Annotated[
            str,
            Field(
                description="New status: opd_referred, opd_visited, ipd_admitted, recovery, chronic_management, follow_up_active"
            ),
        ],
        reason: Annotated[
            str,
            Field(description="What the patient said that indicates this transition"),
        ],
    ) -> str:
        """Update patient journey status when they confirm a care transition during the call.
        Use when patient confirms: visited OPD (opd_visited), got admitted (ipd_admitted), recovering at home (recovery)."""
        if not hasattr(self, "_patient_id"):
            return "Cannot update — patient context not loaded."

        sb = _get_supabase_client()
        if not sb:
            return "Journey noted but database unavailable."

        valid = {
            "opd_referred",
            "opd_visited",
            "ipd_admitted",
            "recovery",
            "chronic_management",
            "follow_up_active",
        }
        if new_status not in valid:
            return f"Invalid status. Use one of: {', '.join(sorted(valid))}"

        try:
            sb.table("patients").update(
                {
                    "journey_status": new_status,
                }
            ).eq("id", self._patient_id).execute()
            self._realtime_actions.add("journey_update")
            logger.info(
                "REAL-TIME JOURNEY: patient=%s → %s",
                self._patient_id[:8],
                new_status,
            )
            return f"Journey status updated to {new_status}."
        except Exception as exc:
            logger.error("Tool update_journey_status failed: %s", exc)
            return "Journey update failed — will retry at call end."

    @llm.function_tool
    async def record_vitals(
        self,
        systolic_bp: Annotated[
            Optional[int], Field(description="Systolic blood pressure if reported")
        ] = None,
        diastolic_bp: Annotated[
            Optional[int], Field(description="Diastolic blood pressure if reported")
        ] = None,
        blood_glucose: Annotated[
            Optional[int], Field(description="Blood glucose in mg/dL if reported")
        ] = None,
        heart_rate: Annotated[
            Optional[int], Field(description="Heart rate bpm if reported")
        ] = None,
    ) -> str:
        """Record self-reported vitals when patient shares home readings during the call.
        Only call when patient explicitly states a number like 'mera BP 160/100 hai' or 'sugar 280 aayi'."""
        if not hasattr(self, "_patient_id"):
            return "Cannot record — patient context not loaded."

        sb = _get_supabase_client()
        if not sb:
            return "Vitals noted but database unavailable."

        record: dict[str, Any] = {"patient_id": self._patient_id}
        if systolic_bp is not None:
            record["systolic_bp"] = systolic_bp
        if diastolic_bp is not None:
            record["diastolic_bp"] = diastolic_bp
        if blood_glucose is not None:
            record["blood_glucose"] = blood_glucose
        if heart_rate is not None:
            record["heart_rate"] = heart_rate

        if len(record) <= 1:
            return "No vitals provided."

        try:
            sb.table("health_vitals").insert(record).execute()
            self._realtime_actions.add("vitals_recorded")
            parts = []
            if systolic_bp:
                parts.append(f"BP {systolic_bp}/{diastolic_bp or '?'}")
            if blood_glucose:
                parts.append(f"glucose {blood_glucose}")
            if heart_rate:
                parts.append(f"HR {heart_rate}")
            logger.info(
                "REAL-TIME VITALS: patient=%s data=%s",
                self._patient_id[:8],
                ", ".join(parts),
            )
            return f"Vitals recorded: {', '.join(parts)}."
        except Exception as exc:
            logger.error("Tool record_vitals failed: %s", exc)
            return "Vitals recording failed."

    @llm.function_tool
    async def confirm_vaccination_visit(
        self,
        confirmed: Annotated[
            bool,
            Field(
                description="True if parent confirms they will bring baby for vaccination"
            ),
        ],
        planned_date: Annotated[
            str,
            Field(
                description="When parent plans to visit, e.g. 'kal', 'next week', or a date"
            ),
        ] = "",
        notes: Annotated[
            str, Field(description="Any concerns or reasons for delay")
        ] = "",
    ) -> str:
        """For vaccination calls only: Record whether the parent confirmed they will bring the baby for the vaccine.
        Call when parent gives a clear yes or no about visiting for the vaccination."""
        if not hasattr(self, "_patient_id"):
            return "Cannot record — patient context not loaded."

        if getattr(self, "_call_type", "") != "newborn_vaccination":
            return "This tool is only for vaccination calls."

        sb = _get_supabase_client()
        if not sb:
            return "Response noted but database unavailable."

        try:
            # Find the next pending vaccination schedule for this patient's baby
            # First get the newborn linked to this parent
            nr = (
                sb.table("newborns")
                .select("id")
                .eq("parent_patient_id", self._patient_id)
                .limit(1)
                .execute()
            )
            if not nr.data:
                return "No baby record found for this parent."

            newborn_id = nr.data[0]["id"]
            vsr = (
                sb.table("vaccination_schedules")
                .select("id")
                .eq("newborn_id", newborn_id)
                .in_("status", ["pending", "overdue"])
                .order("due_date")
                .limit(1)
                .execute()
            )

            if vsr.data:
                new_status = "scheduled" if confirmed else "delayed"
                sb.table("vaccination_schedules").update(
                    {
                        "status": new_status,
                    }
                ).eq("id", vsr.data[0]["id"]).execute()

            self._realtime_actions.add("vaccination_confirmed")
            logger.info(
                "REAL-TIME VACCINATION: patient=%s confirmed=%s date=%s",
                self._patient_id[:8],
                confirmed,
                planned_date,
            )
            return (
                f"Vaccination visit {'confirmed' if confirmed else 'noted as delayed'}."
            )
        except Exception as exc:
            logger.error("Tool confirm_vaccination_visit failed: %s", exc)
            return "Vaccination response recording failed."

    # -----------------------------------------------------------------------
    # Lifecycle hooks (continued)
    # -----------------------------------------------------------------------

    async def on_user_turn_completed(
        self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage
    ) -> None:
        """Capture user speech for transcript and real-time critical keyword detection."""
        if not hasattr(self, "_transcript"):
            return
        text = new_message.text_content or ""
        if text:
            self._transcript.add("user", text)
            logger.info("User said: %s", text[:120])

    async def on_exit(self) -> None:
        """Called when the agent leaves. Persist call data."""
        self._closing = True

        room_io = self.session.room_io
        room_name = room_io.room.name if room_io and room_io.room else "unknown"

        # Build transcript from the actual chat context (captures both user & assistant)
        if hasattr(self, "_transcript"):
            try:
                for item in self.chat_ctx.items:
                    if not hasattr(item, "role"):
                        continue
                    text = getattr(item, "text_content", None) or ""
                    if not text:
                        continue
                    role = "user" if item.role == "user" else "assistant"
                    # Avoid duplicating user turns already added by on_user_turn_completed
                    if role == "assistant":
                        self._transcript.add(role, text)
            except Exception as exc:
                logger.warning("Failed to read chat context: %s", exc)

        logger.info(
            "Call ending — room=%s patient=%s turns=%d critical=%s",
            room_name,
            getattr(self, "_patient_name", "unknown"),
            len(getattr(self, "_transcript", TranscriptAccumulator()).turns),
            getattr(self, "_transcript", TranscriptAccumulator()).is_critical,
        )
        if hasattr(self, "_transcript"):
            await _persist_call_data(
                patient_id=self._patient_id,
                call_type=self._call_type,
                language=self._language,
                transcript=self._transcript,
                realtime_actions=self._realtime_actions,
            )


# ---------------------------------------------------------------------------
# Agent entrypoint
# ---------------------------------------------------------------------------


async def entrypoint(ctx: JobContext) -> None:
    """
    Main agent entrypoint — called by the LiveKit worker when a new room is
    dispatched to this agent process.

    Pipeline:
      - FAST MODE: Deepgram STT -> Groq (Gemini fallback) -> selectable TTS
    """
    # Connect to the room first — REQUIRED before accessing room data
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    logger.info("Agent connected to room: %s", ctx.room.name)

    # Parse room metadata for language
    try:
        metadata: dict[str, Any] = json.loads(ctx.room.metadata or "{}")
    except json.JSONDecodeError:
        metadata = {}

    language: str = metadata.get("language", "hindi").lower()
    bcp47_code = LANGUAGE_CODES.get(language, "hi-IN")

    session_kwargs: dict[str, Any] = {
        "allow_interruptions": True,
        "min_endpointing_delay": 0.3,  # was 0.5 — respond faster
        "max_endpointing_delay": 0.8,  # was 1.5 — cap wait shorter
        "min_interruption_duration": 0.5,
    }

    # ── FAST PIPELINE ───────────────────────────────────────────────
    # STT: Deepgram Nova-3, LLM: Groq primary with Gemini fallback
    logger.info(
        "FAST PIPELINE: Deepgram STT + Groq primary LLM + fallback + configurable TTS"
    )

    stt = deepgram_plugin.STT(
        model="nova-3",
        language=bcp47_code.split("-")[0],  # "hi" from "hi-IN"
        interim_results=True,
        smart_format=True,
        no_delay=True,
        endpointing_ms=300,  # end-of-speech detection: 300ms
    )
    groq_api_key = os.getenv("GROQ_API_KEY", "").strip()
    gemini_llm = google_plugin.LLM(
        model=os.getenv("GOOGLE_LLM_MODEL", "gemini-3-flash-preview"),
        temperature=0.5,
    )
    if groq_api_key:
        groq_llm = openai_plugin.LLM(
            base_url="https://api.groq.com/openai/v1",
            api_key=groq_api_key,
            # groq/compound-mini, not a gpt-oss or qwen model. Measured against this
            # account 2026-08-23 with a Hindi chest-pain prompt:
            #   groq/compound-mini   1069ms  clean Hindi, clinically apt
            #   openai/gpt-oss-120b   731ms  content EMPTY (answer lands in
            #   openai/gpt-oss-20b    579ms  `reasoning`, so TTS speaks nothing)
            #   qwen/qwen3.6-27b      396ms  leaks "<think>" into content, which TTS
            #                                would read aloud to the patient
            # Faster is worthless if the patient hears silence or internal monologue.
            model=os.getenv("GROQ_MODEL", "groq/compound-mini"),
            temperature=0.5,
        )
        # llm.FallbackAdapter, not a hand-rolled wrapper. The one this replaced only
        # failed over on 429; Groq retired llama-3.3-70b-versatile and the 404 was
        # re-raised, so a patient on a live call heard silence for the entire call
        # while Gemini sat idle and healthy. The library adapter catches APIError,
        # timeouts and bare exceptions, tracks each LLM's status, and recovers back
        # to the primary when it returns — none of which the wrapper did.
        llm_model = llm.FallbackAdapter([groq_llm, gemini_llm])
        logger.info("FAST PIPELINE LLM: Groq primary -> Gemini fallback")
    else:
        logger.warning(
            "GROQ_API_KEY missing, falling back to Gemini text LLM in FAST pipeline"
        )
        llm_model = gemini_llm
    # ponytail: ordered "pick one, degrade if unavailable" selector — NOT a runtime
    # failover chain, and deliberately not lk_tts.FallbackAdapter. That adapter takes
    # a list of *already-constructed* instances, but only MURF_API_KEY and
    # DEEPGRAM_API_KEY are set here (sarvam and cartesia have no keys), and Deepgram's
    # configured voice is aura-asteria-en — English. Falling a Hindi call over to an
    # English voice is worse than failing loudly. Switch to lk_tts.FallbackAdapter the
    # moment a second *Indic* provider is funded; the list is already in the right
    # order for it.
    def _murf_tts():
        # Only pass what is explicitly configured. Murf validates `style` against
        # its own library and the docs disagree with their own example
        # ("Conversation" vs "Conversational"), so an unset value must mean "use
        # the plugin default", not a guessed string.
        #
        # MURF_LOCALE is opt-in only: Murf infers locale from the voice id
        # (`{locale}-{name}`), and passing a conflicting one is an error.
        #
        # ponytail: one fixed voice. Add a language -> voice map here when a
        # second language actually ships; guessing Murf voice ids for the other
        # 11 locales would be inventing API surface.
        kwargs: dict[str, object] = {
            "voice": os.getenv("MURF_VOICE", "en-IN-anisha"),
            "model": os.getenv("MURF_MODEL", "FALCON"),
        }
        for env, key, cast in (
            ("MURF_STYLE", "style", str),
            ("MURF_LOCALE", "locale", str),
            ("MURF_SPEED", "speed", int),
            ("MURF_PITCH", "pitch", int),
        ):
            raw = os.getenv(env)
            if raw:
                kwargs[key] = cast(raw)
        # Auth is env-only: the plugin reads MURF_API_KEY itself.
        return murf_plugin.TTS(**kwargs)  # type: ignore[arg-type]

    def _sarvam_tts():
        return (ReliableSarvamTTS or sarvam_plugin.TTS)(
            model=os.getenv("SARVAM_TTS_MODEL", "bulbul:v2"),
            speaker=os.getenv("SARVAM_VOICE", "anushka"),
            target_language_code=os.getenv("SARVAM_LANGUAGE", bcp47_code),
            pace=float(os.getenv("SARVAM_PACE", "0.88")),
            pitch=float(os.getenv("SARVAM_PITCH", "-0.08")),
            temperature=float(os.getenv("SARVAM_TTS_TEMPERATURE", "0.42")),
            enable_preprocessing=True,
        )

    def _cartesia_tts():
        return cartesia_plugin.TTS(
            model=os.getenv("CARTESIA_TTS_MODEL", "sonic-2"),
            voice=os.getenv(
                "CARTESIA_TTS_VOICE", "f786b574-daa5-4673-aa0c-cbe3e8534c02"
            ),
            language=os.getenv("CARTESIA_LANGUAGE", bcp47_code),
            speed=float(os.getenv("CARTESIA_SPEED", "0.92")),
        )

    def _deepgram_tts():
        return deepgram_plugin.TTS(
            model=os.getenv("DEEPGRAM_TTS_MODEL", "aura-asteria-en"),
            sample_rate=24000,
        )

    tts_chain = [
        ("murf", murf_plugin, _murf_tts),
        ("sarvam", sarvam_plugin, _sarvam_tts),
        ("cartesia", cartesia_plugin, _cartesia_tts),
        ("deepgram", deepgram_plugin, _deepgram_tts),
    ]
    preferred = os.getenv("FAST_TTS_PROVIDER", "murf").strip().lower()
    names = [name for name, _, _ in tts_chain]
    if preferred not in names:
        logger.warning("Unknown FAST_TTS_PROVIDER=%r, starting from murf", preferred)
    start_at = names.index(preferred) if preferred in names else 0

    tts = None
    for name, plugin, build in tts_chain[start_at:]:
        if plugin is None:
            logger.warning("%s TTS plugin unavailable, trying next", name)
            continue
        try:
            tts = build()
            logger.info("FAST PIPELINE TTS: %s", name)
            break
        except Exception as exc:
            logger.warning("%s TTS init failed (%s), trying next", name, exc)
    if tts is None:
        raise RuntimeError(
            f"No TTS provider available starting from {preferred!r} "
            f"(tried {', '.join(names[start_at:])})"
        )

    vad = silero_plugin.VAD.load(
        min_silence_duration=0.3,  # detect end of speech faster
    )

    session_kwargs.update(
        {
            "stt": stt,
            "llm": llm_model,
            "tts": tts,
            "vad": vad,
            "turn_detection": "vad",  # fastest turn detection
            "preemptive_generation": True,  # only works with split pipeline
        }
    )

    agent = SwadhikaarAgent()

    session = AgentSession(**session_kwargs)

    await session.start(
        agent=agent,
        room=ctx.room,
    )


# ---------------------------------------------------------------------------
# Worker entry
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Windows consoles default to cp1252, which cannot encode Devanagari. Without
    # this, every "User said: <hindi>" line raises UnicodeEncodeError inside the
    # logger and the transcript is lost from the log — on a Hindi-first product that
    # is most of the interesting output.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    )
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
        ),
    )
