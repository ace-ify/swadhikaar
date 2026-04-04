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
from datetime import datetime, timezone
from typing import Annotated, Any, Optional

from pydantic import Field

from dotenv import load_dotenv

from livekit.agents import (
    APIStatusError,
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

if sarvam_plugin is not None:

    class ReliableSarvamTTS(sarvam_plugin.TTS):
        """Force non-streaming mode to avoid WAV decode failures in current stack."""

        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self._capabilities = lk_tts.TTSCapabilities(streaming=False)
else:
    ReliableSarvamTTS = None


class FailoverLLM(llm.LLM):
    """Primary->fallback LLM wrapper with 429 failover support."""

    def __init__(self, primary: llm.LLM, fallback: llm.LLM, logger: logging.Logger):
        super().__init__()
        self._primary = primary
        self._fallback = fallback
        self._logger = logger

    @property
    def model(self) -> str:
        return f"{self._primary.model} -> {self._fallback.model}"

    @property
    def provider(self) -> str:
        return f"{self._primary.provider} -> {self._fallback.provider}"

    def chat(self, **kwargs):
        try:
            return self._primary.chat(**kwargs)
        except APIStatusError as e:
            status = getattr(e, "status_code", None)
            message = str(e).lower()
            if status == 429 or "rate limit" in message or "rate_limit" in message:
                self._logger.warning(
                    "Primary LLM rate-limited (429). Switching this turn to fallback LLM."
                )
                return self._fallback.chat(**kwargs)
            raise

    async def aclose(self) -> None:
        await self._primary.aclose()
        await self._fallback.aclose()


# Local imports
from prompts.system_prompts import (
    build_system_prompt,
    build_extraction_prompt,
    DEFAULT_CONTEXT,
)

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
    # Backward compat aliases
    "screening_followup": (
        "Namaste {name} ji! Swadhikaar ki taraf se call hai. "
        "Aapka screening mein kuch readings high aayi theen — kya aap abhi theek hain?"
    ),
    "chronic_check": (
        "Namaste {name} ji! Swadhikaar se monthly check-in call hai. "
        "Aapki dawaiyan regular chal rahi hain?"
    ),
    "recovery": (
        "Namaste {name} ji! Aapke discharge ke baad hum check kar rahe hain. "
        "Aapki recovery kaisi chal rahi hai?"
    ),
}

# JSON block regex — to extract structured output from LLM response
_JSON_BLOCK_RE = re.compile(r"```json\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)

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


def _get_supabase_client():
    """Return a cached Supabase client. Creates one on first call."""
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_KEY", "")
    if not url or not key:
        logger.warning("SUPABASE_URL/KEY not set — transcript will not be persisted.")
        return None
    try:
        from supabase import create_client

        _supabase_client = create_client(url, key)
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

    def __init__(self) -> None:
        self.turns: list[dict[str, str]] = []
        self._escalation_triggered = False
        self._high_triggered = False

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

    @property
    def is_critical(self) -> bool:
        return self._escalation_triggered

    @property
    def is_high(self) -> bool:
        return self._high_triggered

    def extract_json_block(self) -> dict[str, Any]:
        """
        Scan all assistant turns (last → first) for the structured JSON block
        the LLM is instructed to emit at the end of the call.
        """
        for turn in reversed(self.turns):
            if turn["role"] != "assistant":
                continue
            match = _JSON_BLOCK_RE.search(turn["text"])
            if match:
                try:
                    return json.loads(match.group(1))
                except json.JSONDecodeError:
                    pass
        return {}

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
    room_name: str,
    realtime_actions: set[str] | None = None,
) -> None:
    """Write transcript + extracted data to Supabase `voice_calls` table.

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

    extracted = transcript.extract_json_block()
    severity = extracted.get("overall_severity", "")
    needs_escalation = extracted.get("needs_escalation", False)

    # Fallback: if LLM didn't produce extraction JSON, determine severity from
    # transcript-level keyword and agent-response detection
    if not severity or severity == "UNKNOWN":
        if transcript.is_critical:
            severity = "CRITICAL"
            needs_escalation = True
        elif transcript.is_high:
            severity = "HIGH"
            needs_escalation = True
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
        "status": "completed" if extracted.get("call_completed") else "ended",
        "language": language,
        "transcript": transcript.to_plain_text(),
        "extracted_data": extracted,
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
                "reason": extracted.get(
                    "escalation_reason", "Critical symptoms detected during call"
                ),
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
        self._system_prompt = (
            system_prompt  # cached for extraction injection at call end
        )

        # Store context for later use
        self._patient_id = patient_id
        self._patient_name = patient_name
        self._call_type = call_type
        self._language = language
        self._transcript = TranscriptAccumulator()

        # ── Start parallel escalation monitor ───────────────────────────
        # Background task that watches transcript for critical/high keywords
        # and creates escalations IMMEDIATELY — independent of LLM tool calls.
        # Acts as a safety net: if Gemini doesn't call escalate_patient tool,
        # this catches it within 1 second of the keyword appearing.
        self._monitor_task = asyncio.create_task(self._escalation_monitor_loop())

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
    # Parallel escalation monitor — runs as background asyncio task
    # -----------------------------------------------------------------------

    async def _escalation_monitor_loop(self) -> None:
        """Background task that polls TranscriptAccumulator every 1s for
        critical/high keyword detections and creates DB escalations
        immediately — independent of the LLM conversation flow.

        This is the 'parallel agent' safety net: if the LLM doesn't call
        the escalate_patient tool (e.g., model failure, hallucination, or
        the patient switches languages mid-sentence), this catches it.
        """
        _monitor_critical_fired = False
        _monitor_high_fired = False

        while True:
            await asyncio.sleep(1.0)  # Check every second

            if not hasattr(self, "_transcript"):
                continue

            # Skip if tool already handled it
            if "escalation" in self._realtime_actions:
                continue

            # Skip vaccination calls — parent's risk shouldn't auto-escalate
            if getattr(self, "_call_type", "") == "newborn_vaccination":
                continue

            # Skip placeholder identifiers
            patient_id = getattr(self, "_patient_id", "")
            if not patient_id or patient_id == "unknown":
                continue

            # CRITICAL detection
            if self._transcript.is_critical and not _monitor_critical_fired:
                _monitor_critical_fired = True
                logger.warning(
                    "MONITOR: CRITICAL keyword detected for patient %s — creating escalation",
                    patient_id[:8],
                )
                try:
                    sb = _get_supabase_client()
                    if sb:
                        sb.table("escalations").insert(
                            {
                                "patient_id": patient_id,
                                "severity_level": "3",
                                "severity": "CRITICAL",
                                "reason": "Critical symptoms detected by background monitor during call",
                                "status": "open",
                            }
                        ).execute()
                        # Also update risk level immediately
                        sb.table("patients").update(
                            {
                                "risk_level": "High",
                                "overall_risk_score": 90,
                            }
                        ).eq("id", patient_id).execute()
                        self._realtime_actions.add("escalation")
                        self._realtime_actions.add("risk_update")
                        logger.warning(
                            "MONITOR: Escalation + risk update created for %s",
                            patient_id[:8],
                        )
                except Exception as exc:
                    logger.error("MONITOR: Escalation insert failed: %s", exc)

            # HIGH detection
            elif self._transcript.is_high and not _monitor_high_fired:
                _monitor_high_fired = True
                logger.info(
                    "MONITOR: HIGH keyword detected for patient %s — creating escalation",
                    patient_id[:8],
                )
                try:
                    sb = _get_supabase_client()
                    if sb:
                        sb.table("escalations").insert(
                            {
                                "patient_id": patient_id,
                                "severity_level": "2",
                                "severity": "HIGH",
                                "reason": "High-severity symptoms detected by background monitor during call",
                                "status": "open",
                            }
                        ).execute()
                        sb.table("patients").update(
                            {
                                "risk_level": "High",
                                "overall_risk_score": 75,
                            }
                        ).eq("id", patient_id).execute()
                        self._realtime_actions.add("escalation")
                        self._realtime_actions.add("risk_update")
                        logger.info(
                            "MONITOR: HIGH escalation + risk update created for %s",
                            patient_id[:8],
                        )
                except Exception as exc:
                    logger.error("MONITOR: HIGH escalation insert failed: %s", exc)

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
        """Called when the agent leaves. Cancel monitor and persist call data."""
        # Cancel the background escalation monitor
        if hasattr(self, "_monitor_task") and not self._monitor_task.done():
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass

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
                room_name=room_name,
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
    gemini_fallback_llm = google_plugin.LLM(
        model=os.getenv("GOOGLE_LLM_MODEL", "gemini-3-flash-preview"),
        temperature=0.5,
    )
    if groq_api_key:
        logger.info("FAST PIPELINE LLM: Groq primary")
        groq_llm = openai_plugin.LLM(
            base_url="https://api.groq.com/openai/v1",
            api_key=groq_api_key,
            model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
            temperature=0.5,
        )
        llm_model = FailoverLLM(groq_llm, gemini_fallback_llm, logger)
    else:
        logger.warning(
            "GROQ_API_KEY missing, falling back to Gemini text LLM in FAST pipeline"
        )
        llm_model = gemini_fallback_llm
    tts_provider = os.getenv("FAST_TTS_PROVIDER", "deepgram").strip().lower()
    if tts_provider == "sarvam":
        if sarvam_plugin is None:
            logger.warning(
                "Sarvam plugin unavailable, falling back to Cartesia/Deepgram"
            )
            tts_provider = "cartesia"
        else:
            try:
                logger.info("FAST PIPELINE TTS: Sarvam (Indian voice)")
                tts_cls = ReliableSarvamTTS or sarvam_plugin.TTS
                tts = tts_cls(
                    model=os.getenv("SARVAM_TTS_MODEL", "bulbul:v2"),
                    speaker=os.getenv("SARVAM_VOICE", "anushka"),
                    target_language_code=os.getenv("SARVAM_LANGUAGE", bcp47_code),
                    pace=float(os.getenv("SARVAM_PACE", "0.88")),
                    pitch=float(os.getenv("SARVAM_PITCH", "-0.08")),
                    temperature=float(os.getenv("SARVAM_TTS_TEMPERATURE", "0.42")),
                    enable_preprocessing=True,
                )
            except Exception as exc:
                logger.warning("Sarvam TTS init failed (%s), falling back", exc)
                tts_provider = "cartesia"

    if tts_provider == "cartesia":
        if cartesia_plugin is None:
            logger.warning("Cartesia plugin unavailable, falling back to Deepgram")
            tts_provider = "deepgram"
        else:
            logger.info("FAST PIPELINE TTS: Cartesia")
            tts = cartesia_plugin.TTS(
                model=os.getenv("CARTESIA_TTS_MODEL", "sonic-2"),
                voice=os.getenv(
                    "CARTESIA_TTS_VOICE", "f786b574-daa5-4673-aa0c-cbe3e8534c02"
                ),
                language=os.getenv("CARTESIA_LANGUAGE", bcp47_code),
                speed=float(os.getenv("CARTESIA_SPEED", "0.92")),
            )

    if tts_provider == "deepgram":
        logger.info("FAST PIPELINE TTS: Deepgram")
        tts = deepgram_plugin.TTS(
            model=os.getenv("DEEPGRAM_TTS_MODEL", "aura-asteria-en"),
            sample_rate=24000,
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
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    )
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
        ),
    )
