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
from typing import Annotated, Any, Callable, Literal, Optional

from pydantic import Field

from dotenv import load_dotenv

from livekit.agents import (
    AgentSession,
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    llm,
)
from livekit.agents.voice import Agent as VoiceAgent
from livekit.plugins import google as google_plugin
from livekit.plugins import deepgram as deepgram_plugin
from livekit.plugins import openai as openai_plugin
from livekit.plugins import silero as silero_plugin

try:
    from livekit.agents import inference as inference_module
except Exception:
    inference_module = None

try:
    from livekit.plugins import sarvam as sarvam_plugin
except Exception:  # pragma: no cover
    sarvam_plugin = None

try:
    from livekit.plugins import murf as murf_plugin
except Exception:  # pragma: no cover
    murf_plugin = None

try:
    from livekit.plugins import rime as rime_plugin
except Exception:  # pragma: no cover
    rime_plugin = None


# Local imports
from prompts.system_prompts import build_system_prompt, DEFAULT_CONTEXT

# Explicit path, not bare load_dotenv(). The implicit form walks up from the calling
# frame's directory, so it silently finds nothing when agent.py is imported from a
# script elsewhere in the tree — and "no credentials" here means every transcript,
# escalation and journey update is dropped. backend/.env (not .env.local: dotenv does
# not look for that name).
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

logger = logging.getLogger("swadhikaar.agent")

# Suppress noisy HTTP/2 and low-level connection debug logging that floods
# the console and blocks the asyncio event loop during Supabase calls.
for _noisy_logger in ("hpack", "httpcore", "httpx"):
    logging.getLogger(_noisy_logger).setLevel(logging.WARNING)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Languages → BCP-47 codes, shared by STT and every TTS provider.
# WHICH CATALOGUE YOU ARE LOOKING AT
# Murf serves TWO voice libraries and the endpoint defaults to the wrong one for us.
# GET /v1/speech/voices returns 162 "Gen2" studio voices; GET
# /v1/speech/voices?model=FALCON returns 117 streaming voices, and they barely
# overlap. The LiveKit plugin defaults to model="FALCON", so FALCON is the only list
# that describes what this agent can actually say. Querying the unfiltered endpoint
# is how en-IN-anisha got declared non-existent and replaced with three Gen2 voices
# that answer 400 on the streaming path. Always pass ?model=FALCON.
#
# STT AND TTS DO NOT AGREE ON LANGUAGES, SO THEY GET SEPARATE COLUMNS
# Deepgram nova-3 has no Assamese; Murf FALCON does. Deepgram has Urdu; Murf has no
# Urdu voice at all. Collapsing both into one code meant Assamese would have crashed
# STT and Urdu was being transcribed as Hindi for no reason. Neither provider
# validates a language in its constructor, so both failures land mid-call.
#
# language -> (Deepgram STT code, TTS BCP-47)
LANGUAGES: dict[str, tuple[str, str]] = {
    "hindi": ("hi", "hi-IN"),
    "english": ("en-IN", "en-IN"),
    "bengali": ("bn", "bn-IN"),
    "tamil": ("ta", "ta-IN"),
    "telugu": ("te", "te-IN"),
    "marathi": ("mr", "mr-IN"),
    "gujarati": ("gu", "gu-IN"),
    "kannada": ("kn", "kn-IN"),
    "malayalam": ("ml", "ml-IN"),
    "punjabi": ("pa", "pa-IN"),
    # Assam speaks Assamese out and is understood in Bengali. Murf FALCON has a real
    # as-IN voice — verified as 6.37s of Assamese audio through the plugin, not from
    # a docs page — so the advisory is genuinely in Assamese. Deepgram nova-3 does
    # not list "as", so comprehension degrades to Bengali, the nearest Eastern
    # Indo-Aryan language it does have. For an outbound advisory the speaking half is
    # the half that matters.
    "assamese": ("bn", "as-IN"),
    # Urdu — 45 patients here. Deepgram transcribes "ur" natively, so use it; Murf
    # has no Urdu voice in either catalogue, and spoken Hindustani is common to both
    # languages, so a Hindi voice is right for the audio even though scripts differ.
    "urdu": ("ur", "hi-IN"),
    # Dialects — Hindi is the closest thing either provider models.
    "bhojpuri": ("hi", "hi-IN"),
    "maithili": ("hi", "hi-IN"),
}

# WHICH VOICE ACTUALLY EXISTS
# Every entry verified by synthesising real audio through the plugin on 2026-08-25,
# because a voice id is accepted by the constructor and only rejected at synthesis —
# "it initialised fine" proves nothing here.
#
# en-IN-anisha carries 11 of the 12 locales below, so one voice covers nearly the
# whole country. That is deliberate: a health service calling the same household in
# Hindi one week and Assamese the next should sound like the same organisation.
# Gujarati is the only gap and gets a native voice.
#
# Style is per-voice and per-locale. anisha advertises "Conversation" for native
# en-IN, while under supportedLocales all Indic multi-native locales (hi-IN, bn-IN,
# ta-IN, etc.) advertise "Conversational".
#
# bcp47 -> (voice, multiNativeLocale or None if the voice is native, style or None)
MURF_VOICES: dict[str, tuple[str, str | None, str | None]] = {
    "en-IN": ("en-IN-anisha", None, "Conversation"),
    # anisha reaching each of these was measured, one synthesis per locale:
    # as 6.37s, hi 6.01s, bn 3.45s, ta 2.77s, te 2.85s, or 2.89s.
    "as-IN": ("en-IN-anisha", "as-IN", "Conversational"),
    "hi-IN": ("en-IN-anisha", "hi-IN", "Conversational"),
    "bn-IN": ("en-IN-anisha", "bn-IN", "Conversational"),
    "ta-IN": ("en-IN-anisha", "ta-IN", "Conversational"),
    "te-IN": ("en-IN-anisha", "te-IN", "Conversational"),
    "or-IN": ("en-IN-anisha", "or-IN", "Conversational"),
    "kn-IN": ("en-IN-anisha", "kn-IN", "Conversational"),
    "ml-IN": ("en-IN-anisha", "ml-IN", "Conversational"),
    "mr-IN": ("en-IN-anisha", "mr-IN", "Conversational"),
    "pa-IN": ("en-IN-anisha", "pa-IN", "Conversational"),
    # The one locale anisha does not carry. Native voice, verified 3.57s.
    "gu-IN": ("gu-IN-diya", None, "Conversational"),
}

SARVAM_LANGS = frozenset({
    "hi-IN", "bn-IN", "en-IN", "ta-IN", "te-IN",
    "gu-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "od-IN",
})
# Sarvam bulbul v2/v3: 11 languages (10 Indic + English), from the model reference
# on 2026-08-25. No Assamese, so on an Assamese call Murf is the only provider that
# can speak at all and the gate skips straight past Sarvam. Sarvam spells Odia
# "od-IN" where Murf spells it "or-IN" — same language, neither is a typo, which is
# why these stay two separate sets instead of one shared constant.


# RIME — A FOURTH SPELLING OF THE SAME LANGUAGES
# Deepgram says "hi", Murf says "hi-IN", Sarvam says "od-IN" where Murf says "or-IN",
# and Rime says "hin". Rime takes ISO 639-3, so the bcp47 code this module passes
# everywhere else has to be translated, not sliced.
#
# Everything below was read out of the installed plugin (livekit-plugins-rime 1.7.0)
# and the live catalogue at https://users.rime.ai/data/voices/all-v2.json, because
# three sources disagree about how many languages Coda has: docs.rime.ai says 9, the
# live catalogue agrees (eng jpn spa por ger fra ara hin ita), and the plugin's
# TTSLangs enum lists 5. The enum is a stale type hint — lang is typed
# `TTSLangs | str`, so the catalogue is the real limit. Both of ours are in all three.
# Of the nine, two are ours. There is no Assamese, Bengali, Tamil, Gujarati, Urdu,
# Bhojpuri or Maithili, so on any of those calls tts_candidates() skips Rime and Murf
# speaks. That gate is the disclosed fallback, not a workaround.
#
# THREE DEFAULTS THAT LIE, all the en-US-matthew mistake in a new costume:
#   lang defaults to "eng" — a Hindi call that forgets it speaks English.
#   speaker depends on whether you NAMED the model: implicit coda -> "astra",
#     explicit model="coda" -> "lyra". So pass both or you cannot predict either.
#   use_websocket defaults to False, and tts.py:183 gates BOTH streaming and
#     aligned_transcript on it. HTTP means whole-utterance buffering and no word
#     timestamps — unusable for barge-in. Always True.
#
# ONE FEATURE THAT IS NOT WHERE THE DOCS IMPLY: pause_between_brackets and
# phonemize_between_brackets are wired into _MistOptions only, never _CodaOptions
# (tts.py:229-243). Bracket phonemes — the obvious knob for drug names and dosages —
# need a mist model, and no mist model has Hindi. So for Hindi that knob does not
# exist, and pronunciation has to be controlled from the text side.
#
# TWO THINGS MEASURED, NOT READ: the HTTP endpoint answers 200 with audio/pcm on
# coda/hin where the WS path 502s if you reconnect immediately, so a WS failure is
# not evidence the voice is bad. And time-to-first-frame over WS from this machine is
# 1.2-1.5s against an advertised sub-200ms end to end — cold connect, US endpoint,
# bySentence segmentation. Do not repeat the 200ms figure as ours.
#
# bcp47 -> (speaker, Rime lang code)
RIME_VOICES: dict[str, tuple[str, str]] = {
    # "astra" is the plugin's own implicit default (tts.py:206) and is present in the
    # live eng catalogue (162 Coda English voices). Rendered over HTTP, not yet over
    # the WS path this builder uses.
    "en-IN": ("astra", "eng"),
    # Coda is the ONLY model with Hindi — mistv3 has eng/spa/ger/fra and nothing else,
    # which is also why bracket phonemization is unavailable to us at all.
    #
    # The live catalogue lists three Hindi voices: hin, nadi, taru. Only two of them
    # work. "hin" — a voice whose name is the language code — completes the WS
    # handshake and then dies with "ws closed unexpectedly", reproducibly, in a fresh
    # process. Rime's own docs warn an invalid voice/language pair "may not return an
    # error"; this is that, and it is the whole reason this row could not be copied
    # out of the catalogue.
    #
    # nadi and taru both rendered the Hinglish fixture: nadi 11.94s of audio at
    # 1.46s TTFB, taru 12.98s at 1.23s. nadi is the tighter delivery of the two and
    # is otherwise an arbitrary pick between two working voices.
    #
    # WHAT IS VERIFIED AND WHAT IS NOT: synthesis succeeded and the wav is on disk at
    # tmp/rime/coda-hin-nadi.wav. NOBODY HAS LISTENED TO IT. Bytes are not
    # intelligibility, and the fixture deliberately contains the two things most
    # likely to come out wrong — "chest pain" and "Metformin" inside a Devanagari
    # sentence. Listen before this goes in front of a patient or a judge.
    "hi-IN": ("nadi", "hin"),
    # No Assamese, Bengali, Tamil, Gujarati, Urdu, Bhojpuri or Maithili — see above.
    # tts_candidates() skips Rime on those calls and Murf speaks.
}


def tts_candidates(chain, preferred, bcp47_code):
    """Viable TTS providers for one call, best first.

    `chain` is [(name, plugin_or_None, builder, langs_or_None)]. Drops providers
    that are not installed and providers with no voice for `bcp47_code`, and moves
    `preferred` to the front. Pure — builders are returned, never called — so the
    ordering and the language gate can be checked without a network or a key.
    """
    if preferred not in {name for name, _, _, _ in chain}:
        logger.warning("Unknown FAST_TTS_PROVIDER=%r, using murf", preferred)
        preferred = "murf"
    # sorted() is stable, so a False/True key lifts one entry without disturbing
    # the order of the rest. The previous code sliced the list at the preferred
    # index, so FAST_TTS_PROVIDER=sarvam could never fall back to murf — it could
    # only fall forward into the English-voice providers.
    out = []
    for name, plugin, build, langs in sorted(chain, key=lambda e: e[0] != preferred):
        if plugin is None:
            logger.warning("%s TTS plugin not installed, skipping", name)
            continue
        # The "no Assamese voice in Murf, so use Sarvam" rule, generalised: a
        # provider that cannot speak this call's language is skipped rather than
        # used with whatever voice it does have. langs=None means we have no
        # verified list, so try it and let the provider reject what it cannot say.
        if langs is not None and bcp47_code not in langs:
            logger.info("%s has no %s voice, skipping", name, bcp47_code)
            continue
        out.append((name, build))
    return out

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
    # The kiosk. Not a call — the patient is standing at a screen, so this does not
    # open with "Swadhikaar se call hai", and it says up front why a machine is asking,
    # because a stranger asked medical questions by a screen with no explanation stops
    # answering. The last line is the one that matters: their words are enough.
    "case_taking": (
        "Namaste {name} ji. Doctor saheb se milne se pehle main aapki takleef "
        "likh loonga, taaki andar aapka samay bachche. "
        "Aaj aapko kya takleef hai? Apne shabdon mein bataiye."
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
    # "beh" (flowing) as well as "aa" (coming) — this was the ONE critical keyword
    # the unreachable triage-assess edge function had that the live path did not.
    # Merged here rather than left in a function nothing calls.
    "khoon beh raha hai",
    "khoon beh",
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
        # Defence in depth for the bug above: only spoken turns belong in a
        # transcript. A system prompt scanned as speech reads as a patient in
        # cardiac arrest, because the prompt enumerates the red-flag keywords.
        if role not in ("user", "assistant"):
            logger.warning("Ignoring %r turn — only speech belongs in a transcript", role)
            return
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


def _sync_persist_call_data(
    patient_id: str,
    call_type: str,
    language: str,
    transcript: TranscriptAccumulator,
    realtime_actions: set[str],
) -> None:
    """Synchronously write transcript + detected severity to Supabase tables."""
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


async def _persist_call_data(
    patient_id: str,
    call_type: str,
    language: str,
    transcript: TranscriptAccumulator,
    realtime_actions: set[str] | None = None,
) -> None:
    """Write transcript + detected severity to Supabase `voice_calls` table asynchronously.

    Runs database operations in a background worker thread via `asyncio.to_thread`
    to prevent blocking the asyncio event loop and keep VAD and audio streaming realtime.
    """
    if realtime_actions is None:
        realtime_actions = set()
    await asyncio.to_thread(
        _sync_persist_call_data,
        patient_id=patient_id,
        call_type=call_type,
        language=language,
        transcript=transcript,
        realtime_actions=realtime_actions,
    )


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
        # Case taking (PS1 Module A). session_id is what every history_answers row hangs
        # off, so a case_taking room without one is a room that will record nothing —
        # checked and logged loudly below rather than discovered in an empty summary.
        session_id: str | None = metadata.get("session_id")
        interview_mode: str = str(metadata.get("mode", "allopathic")).lower()
        if interview_mode not in ("allopathic", "ayush"):
            logger.warning("Unknown interview mode %r — using allopathic", interview_mode)
            interview_mode = "allopathic"
        if call_type == "case_taking" and not session_id:
            logger.error(
                "case_taking room %s has no session_id in metadata. The interview will "
                "run and NOTHING will be persisted.",
                room.name,
            )

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
            # Case taking. The three "already on record" lines exist so the agent does
            # not spend a two-minute interview asking a diabetic whether they have
            # diabetes; the kiosk resolves them from patients.chronic_conditions,
            # current_medications and allergies before the room is created.
            "language": language.capitalize(),
            "interview_mode": interview_mode,
            "known_conditions": metadata.get("known_conditions", "Nothing on record"),
            "known_medications": metadata.get("known_medications", "Nothing on record"),
            "known_allergies": metadata.get("known_allergies", "Nothing on record"),
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
        self._session_id = session_id
        self._interview_mode = interview_mode
        # Counted so on_exit can log how much of the history actually landed. An
        # interview that talked for four minutes and wrote three rows is a failure that
        # looks like a success in the transcript.
        self._answers_recorded = 0
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

        def _sync_insert():
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

        try:
            await asyncio.to_thread(_sync_insert)
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
        # Deliberately NOT a Literal, unlike the sibling tools above. On a clinical
        # escalation path, coercing an unrecognised severity UP to HIGH is a fail-safe:
        # a pydantic rejection would drop the escalation entirely, and over-escalating
        # a patient is recoverable where losing the alert is not. Do not "fix" this
        # into a Literal to match the others.
        if severity_upper not in ("CRITICAL", "HIGH"):
            logger.warning(
                "Unrecognised severity %r from the model — escalating as HIGH rather "
                "than dropping the alert",
                severity,
            )
            severity_upper = "HIGH"

        try:
            await asyncio.to_thread(
                lambda: sb.table("escalations").insert(
                    {
                        "patient_id": self._patient_id,
                        "severity_level": "3" if severity_upper == "CRITICAL" else "2",
                        "severity": severity_upper,
                        "reason": reason,
                        "status": "open",
                    }
                ).execute()
            )
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
        # Literal, not str: the framework turns this into a JSON-schema enum on the
        # tool definition the model sees, and pydantic rejects anything else. The
        # previous `str` + `score_map.get(level, 50)` silently wrote score=50 for any
        # unrecognised value — a model answering "Critical" produced
        # risk_level="Critical" with a mid-band score, recording a critical patient
        # as moderate.
        new_level: Annotated[
            Literal["High", "Moderate", "Low"],
            Field(description="New risk level"),
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

        # No fallback score: the Literal above guarantees a key exists.
        level = new_level
        score = {"High": 80, "Moderate": 50, "Low": 20}[level]

        try:
            await asyncio.to_thread(
                lambda: sb.table("patients").update(
                    {
                        "risk_level": level,
                        "overall_risk_score": score,
                    }
                ).eq("id", self._patient_id).execute()
            )
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
        # Literal puts the valid statuses in the tool schema the model receives, so it
        # rarely emits a bad one and pydantic rejects it if it does. The hand-written
        # `valid = {...}` set below this only caught it AFTER the model had answered.
        new_status: Annotated[
            Literal[
                "opd_referred",
                "opd_visited",
                "ipd_admitted",
                "recovery",
                "chronic_management",
                "follow_up_active",
            ],
            Field(description="The care transition the patient just confirmed"),
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

        try:
            await asyncio.to_thread(
                lambda: sb.table("patients").update(
                    {
                        "journey_status": new_status,
                    }
                ).eq("id", self._patient_id).execute()
            )
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
        # Bounds are enforced by pydantic, not hoped for. These write straight into
        # health_vitals, which risk-predict scores — an LLM mis-hearing "one sixty" as
        # 1600 would put a fabricated reading into a clinical record. Ranges are
        # survivable-human, not normal: the point is to reject transcription noise,
        # not to reject a genuinely sick patient.
        systolic_bp: Annotated[
            Optional[int], Field(default=None, ge=50, le=300,
                                 description="Systolic blood pressure if reported")
        ] = None,
        diastolic_bp: Annotated[
            Optional[int], Field(default=None, ge=30, le=200,
                                 description="Diastolic blood pressure if reported")
        ] = None,
        blood_glucose: Annotated[
            Optional[int], Field(default=None, ge=20, le=800,
                                 description="Blood glucose in mg/dL if reported")
        ] = None,
        heart_rate: Annotated[
            Optional[int], Field(default=None, ge=25, le=250,
                                 description="Heart rate bpm if reported")
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
            await asyncio.to_thread(
                lambda: sb.table("health_vitals").insert(record).execute()
            )
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

        def _sync_vaccination_update():
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
            return None

        try:
            err = await asyncio.to_thread(_sync_vaccination_update)
            if err:
                return err

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

    # ------------------------------------------------------------------------
    # Case taking — PS1 Module A. Four tools, and all four are no-ops without a
    # session_id, so they say so out loud rather than dropping the answer silently.
    # ------------------------------------------------------------------------

    def _case_session(self) -> tuple[str | None, Any]:
        """The two things every case-taking tool needs, or a reason it cannot work."""
        session_id = getattr(self, "_session_id", None)
        if not session_id:
            return None, None
        return session_id, _get_supabase_client()

    @llm.function_tool
    async def record_history_answer(
        self,
        item_code: Annotated[
            str,
            Field(
                description=(
                    "Ontology item code from the OUTLINE, e.g. cc.main, hpi.onset, "
                    "ros.neurological. Must be one of the codes listed in the prompt."
                )
            ),
        ],
        section: Annotated[
            str,
            Field(
                description=(
                    "One of: chief_complaint, hpi, past_medical, drug_allergy, family, "
                    "personal, ros, investigations"
                )
            ),
        ],
        answer_text: Annotated[
            str,
            Field(
                description=(
                    "What the patient actually said, in their own words and their own "
                    "language. Do not translate, summarise or clean it up."
                )
            ),
        ],
    ) -> str:
        """Record one answer in the patient's history. Call once per answer, immediately
        after the patient gives it — the kiosk screen shows the patient what has been
        captured, and the doctor's summary is built from these rows."""
        session_id, sb = self._case_session()
        if not session_id:
            return "Not a kiosk session — answer noted in the transcript only."
        if not sb:
            return "Answer noted but database unavailable."

        # Sections are a closed set in the database (history_answers_section_check), so
        # a model that invents one would raise and lose the answer. Falling back to the
        # code's own prefix recovers most mistakes: "hpi.onset" -> "hpi".
        valid = {
            "chief_complaint", "hpi", "past_medical", "drug_allergy",
            "family", "personal", "ros", "investigations",
        }
        section_clean = (section or "").strip().lower()
        if section_clean not in valid:
            prefix = {
                "cc": "chief_complaint", "hpi": "hpi", "pm": "past_medical",
                "da": "drug_allergy", "fam": "family", "per": "personal",
                "ros": "ros", "inv": "investigations",
            }.get(item_code.split(".")[0], None)
            if prefix is None:
                logger.warning(
                    "record_history_answer: unusable section=%r item_code=%r, dropping",
                    section, item_code,
                )
                return "Could not file that answer — ask the question again differently."
            logger.info("Repaired section %r -> %r from item_code", section, prefix)
            section_clean = prefix

        try:
            # Upsert on the unique (session_id, item_code): a patient who corrects
            # themselves during the read-back overwrites rather than creating a second
            # contradictory row for the doctor to choose between.
            sb.table("history_answers").upsert(
                {
                    "session_id": session_id,
                    "section": section_clean,
                    "item_code": item_code.strip(),
                    "answer_text": answer_text,
                    "source": "voice",
                },
                on_conflict="session_id,item_code",
            ).execute()
            self._answers_recorded = getattr(self, "_answers_recorded", 0) + 1
            self._realtime_actions.add("history_answer")
            return "Recorded. Ask the next question."
        except Exception as exc:
            logger.error("Tool record_history_answer failed (%s): %s", item_code, exc)
            return "That did not save — continue, it will be in the transcript."

    @llm.function_tool
    async def record_dashavidha(
        self,
        factor: Annotated[
            str,
            Field(
                description=(
                    "One of: prakriti, vikriti, sara, samhanana, pramana, satmya, "
                    "sattva, ahara_shakti, vyayama_shakti, vaya"
                )
            ),
        ],
        value: Annotated[
            str,
            Field(
                description=(
                    "The graded answer. For sara, samhanana, sattva, ahara_shakti and "
                    "vyayama_shakti use pravara, madhyama or avara. For prakriti and "
                    "vikriti use vata, pitta, kapha or a pair like vata_pitta. For "
                    "pramana and vaya give the number the patient stated."
                )
            ),
        ],
        detail: Annotated[
            str,
            Field(description="The patient's own words that led to this value."),
        ],
    ) -> str:
        """AYUSH MODE ONLY. Record one of the ten factors of Dashavidha Pariksha.
        You are recording what the patient reported, not determining their constitution —
        say nothing to them about what any answer means."""
        session_id, sb = self._case_session()
        if not session_id:
            return "Not a kiosk session — noted in the transcript only."
        if getattr(self, "_interview_mode", "allopathic") != "ayush":
            # Refused rather than stored. A Dashavidha row on an allopathic session would
            # print an Ayurvedic assessment on a summary nobody asked for it on.
            logger.warning("record_dashavidha called on a %s session", self._interview_mode)
            return "This is not an Ayush consultation — skip the ten-fold examination."
        if not sb:
            return "Noted but database unavailable."

        factor_clean = (factor or "").strip().lower()
        if factor_clean not in {
            "prakriti", "vikriti", "sara", "samhanana", "pramana",
            "satmya", "sattva", "ahara_shakti", "vyayama_shakti", "vaya",
        }:
            logger.warning("record_dashavidha: unknown factor %r", factor)
            return f"{factor} is not one of the ten factors — check the list and retry."

        try:
            sb.table("dashavidha_assessments").upsert(
                {
                    "session_id": session_id,
                    "factor": factor_clean,
                    "value": (value or "").strip() or None,
                    "detail": {"patient_words": detail} if detail else None,
                    "source": "voice",
                },
                on_conflict="session_id,factor",
            ).execute()
            self._realtime_actions.add("dashavidha")
            return "Recorded. Next factor."
        except Exception as exc:
            logger.error("Tool record_dashavidha failed (%s): %s", factor_clean, exc)
            return "That did not save — continue."

    @llm.function_tool
    async def raise_red_flag(
        self,
        reason: Annotated[
            str,
            Field(
                description=(
                    "What the patient reported, in English, specific enough for a triage "
                    "nurse to act on. E.g. 'chest pain 3 days, worse on walking, with "
                    "breathlessness' — not 'possible cardiac event'."
                )
            ),
        ],
        severity: Annotated[str, Field(description="CRITICAL or HIGH")],
    ) -> str:
        """Raise an immediate triage alert. Call the INSTANT a danger sign appears —
        before finishing your sentence, without a confirming question, without asking
        permission. Then keep the patient calm and carry on if they can answer."""
        session_id, sb = self._case_session()
        if not sb:
            # No early return on a missing session: a red flag from a non-kiosk call is
            # still a red flag, and escalate_patient's path handles it.
            logger.error("RED FLAG with no database: %s", reason)
            return "Alert noted. Tell the patient to stay seated and that staff are coming."

        severity_upper = (severity or "").upper()
        # Same fail-safe as escalate_patient and for the same reason: over-escalating is
        # recoverable, losing the alert is not.
        if severity_upper not in ("CRITICAL", "HIGH"):
            logger.warning("Unrecognised red flag severity %r — treating as CRITICAL", severity)
            severity_upper = "CRITICAL"

        escalation_id = None
        try:
            if getattr(self, "_patient_id", "unknown") != "unknown":
                res = (
                    sb.table("escalations")
                    .insert(
                        {
                            "patient_id": self._patient_id,
                            "severity_level": "3" if severity_upper == "CRITICAL" else "2",
                            "severity": severity_upper,
                            "reason": f"[kiosk] {reason}",
                            "status": "open",
                        }
                    )
                    .execute()
                )
                if res.data:
                    escalation_id = res.data[0].get("id")
        except Exception as exc:
            logger.error("Red flag escalation insert failed: %s", exc)

        # The session flag is written even if the escalation insert failed. The kiosk
        # screen and the doctor's queue both read case_sessions.red_flag, so this is the
        # write that changes what a human sees.
        if session_id:
            try:
                sb.table("case_sessions").update(
                    {
                        "red_flag": True,
                        "red_flag_reason": f"{severity_upper}: {reason}",
                        **({"escalation_id": escalation_id} if escalation_id else {}),
                    }
                ).eq("id", session_id).execute()
            except Exception as exc:
                logger.error("Red flag session update failed: %s", exc)

        self._realtime_actions.add("red_flag")
        logger.warning(
            "KIOSK RED FLAG: session=%s severity=%s reason=%s",
            (session_id or "none")[:8],
            severity_upper,
            reason,
        )
        return (
            "Alert raised, the triage desk has it. Tell the patient staff are coming and "
            "to stay seated. Do not name a diagnosis. Continue the history if they can answer."
        )

    @llm.function_tool
    async def finish_history(self) -> str:
        """Call when every section is done, or when the patient wants to stop. This moves
        the session on so the summary can be generated and the doctor's screen updated."""
        session_id, sb = self._case_session()
        if not session_id or not sb:
            return "Interview finished."

        recorded = getattr(self, "_answers_recorded", 0)
        try:
            # 'summarising', not 'ready': the summary does not exist yet, and a session
            # marked ready with no summary is a doctor opening an empty screen.
            #
            # An ISO timestamp, not the string "now()". PostgREST sends this value as
            # text for Postgres to cast, and casting 'now()' to timestamptz raises —
            # the update would have failed and left the session stuck in 'interviewing'.
            sb.table("case_sessions").update(
                {
                    "status": "summarising",
                    "ended_at": datetime.now(timezone.utc).isoformat(),
                }
            ).eq("id", session_id).execute()
        except Exception as exc:
            logger.error("finish_history could not close session %s: %s", session_id, exc)

        logger.info(
            "Case taking finished: session=%s answers=%d mode=%s",
            session_id[:8],
            recorded,
            getattr(self, "_interview_mode", "?"),
        )
        if recorded == 0:
            # Worth shouting about. A four-minute interview that wrote nothing looks
            # perfectly healthy in the transcript and produces an empty summary.
            logger.error(
                "Session %s finished with ZERO recorded answers — the tool was never "
                "called successfully. Check history_answers writes.",
                session_id[:8],
            )
        return f"History complete, {recorded} answers recorded. Tell the patient they can go in."



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
                    role = getattr(item, "role", None)
                    # ONLY real assistant turns. `else "assistant"` filed the system
                    # prompt as agent speech, and that prompt lists every escalation
                    # keyword ("chest pain", "breathlessness", "108 call karein") — so
                    # the keyword monitor fired on the agent's own instructions and
                    # every single call produced a false CRITICAL escalation. Three
                    # were in production. A triage queue full of fake criticals is
                    # worse than no queue: it trains the doctor to ignore it.
                    if role != "assistant":
                        continue
                    text = getattr(item, "text_content", None) or ""
                    if not text:
                        continue
                    # User turns are already captured by on_user_turn_completed.
                    self._transcript.add("assistant", text)
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

    # Keep console clean and unblocked during live calls
    for _noisy_logger in ("hpack", "httpcore", "httpx"):
        logging.getLogger(_noisy_logger).setLevel(logging.WARNING)

    logger.info("Agent connected to room: %s", ctx.room.name)

    # Parse room metadata for language
    try:
        metadata: dict[str, Any] = json.loads(ctx.room.metadata or "{}")
    except json.JSONDecodeError:
        metadata = {}

    language: str = metadata.get("language", "hindi").lower()
    # Two codes, not one. Deepgram and Murf disagree about which languages exist, so
    # deriving the STT code by chopping the TTS one (bcp47_code.split("-")[0]) sent
    # "as" to a model that has no Assamese and "hi" to Urdu speakers Deepgram can
    # transcribe natively.
    stt_language, bcp47_code = LANGUAGES.get(language, ("hi", "hi-IN"))

    session_kwargs: dict[str, Any] = {
        "turn_handling": {
            "turn_detection": "vad",
            "endpointing": {
                "min_delay": 0.3,  # respond quickly when user stops speaking
                "max_delay": 0.8,
            },
            "interruption": {
                "enabled": True,
                "mode": "vad",  # local VAD only: avoids remote inference timeout (408) and false-interruption stutter
                "min_duration": 0.5,
                "resume_false_interruption": False,
            },
            "preemptive_generation": {
                "enabled": True,
            },
        },
    }

    # ── FAST PIPELINE ───────────────────────────────────────────────
    # STT: Deepgram Nova-3, LLM: Groq primary with Gemini fallback
    logger.info(
        "FAST PIPELINE: Deepgram STT + Groq primary LLM + fallback + configurable TTS"
    )

    # Multilingual STT & mid-convo language switching:
    # 1. If DEEPGRAM_STT_LANGUAGE is configured (e.g. "multi" or "hi"), use it so callers
    #    can switch freely between Hindi, English, and regional words.
    # 2. If language is Assamese: Deepgram Nova-3 has no native "as" model. Falling back
    #    to "bn" forcefully converts Hindi/Hinglish speech into mangled Bengali script.
    #    Default to "multi" so Hindi and English speech are accurately transcribed.
    # 3. Otherwise use the language's mapped STT code.
    configured_stt_lang = os.getenv("DEEPGRAM_STT_LANGUAGE", "").strip().lower()
    if configured_stt_lang:
        effective_stt_language = configured_stt_lang
    elif language == "assamese":
        effective_stt_language = "multi"
    else:
        effective_stt_language = stt_language

    logger.info("Deepgram STT configured with language: %s (caller language: %s)", effective_stt_language, language)

    stt = deepgram_plugin.STT(
        model=os.getenv("DEEPGRAM_STT_MODEL", "nova-3"),
        language=effective_stt_language,
        interim_results=True,
        smart_format=True,
        no_delay=True,
        endpointing_ms=300,  # end-of-speech detection: 300ms
    )
    # ── LLM CHAIN: Gemini (Primary) -> Groq (Fallback) -> LiveKit Inference (Tertiary) ──
    # 1. Primary: Direct Google Gemini (1,000,000 TPM limit on free tier, supports tool calling + Hindi)
    google_model = os.getenv("GOOGLE_LLM_MODEL", "gemini-2.5-flash").strip()
    gemini_llm = google_plugin.LLM(
        model=google_model,
        temperature=0.5,
    )
    active_llms = [gemini_llm]

    # 2. Secondary fallback: Groq (ultra-fast inference ~500ms, fallback when Gemini is busy)
    groq_api_key = os.getenv("GROQ_API_KEY", "").strip()
    if groq_api_key:
        groq_llm = openai_plugin.LLM(
            base_url="https://api.groq.com/openai/v1",
            api_key=groq_api_key,
            model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
            temperature=0.5,
        )
        active_llms.append(groq_llm)

    # 3. Tertiary fallback: LiveKit Cloud Inference (cheapest, high-limit model on LiveKit servers)
    # Uses existing LIVEKIT_API_KEY and LIVEKIT_API_SECRET with free monthly cloud credits
    if inference_module:
        livekit_inf_model = os.getenv("LIVEKIT_INFERENCE_MODEL", "google/gemini-2.5-flash").strip()
        try:
            livekit_llm = inference_module.LLM(model=livekit_inf_model)
            active_llms.append(livekit_llm)
        except Exception as exc:
            logger.warning("LiveKit Inference LLM could not be initialized: %s", exc)

    # 4. Optional OpenAI fallback if explicitly configured
    openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if openai_api_key:
        openai_llm = openai_plugin.LLM(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            temperature=0.5,
        )
        active_llms.append(openai_llm)

    attempt_timeout = float(os.getenv("LLM_ATTEMPT_TIMEOUT", "15.0"))
    if len(active_llms) > 1:
        llm_model = llm.FallbackAdapter(active_llms, attempt_timeout=attempt_timeout)
        chain_names = " -> ".join([getattr(m, "model", type(m).__name__) for m in active_llms])
        logger.info("FAST PIPELINE LLM chain: %s (attempt_timeout=%ss)", chain_names, attempt_timeout)
    else:
        llm_model = active_llms[0]
    # ponytail: ordered "pick one, degrade if unavailable" selector — NOT a runtime
    # failover chain, and deliberately not tts.FallbackAdapter. That adapter takes a
    # list of *already-constructed* instances, so every provider would have to hold
    # credentials at startup; only MURF_API_KEY is set here. Switch to
    # livekit.agents.tts.FallbackAdapter once a second Indic provider is funded; the
    # list is already in the right order for it.
    #
    # Providers are murf / rime / sarvam / google, chosen with FAST_TTS_PROVIDER.
    # Cartesia and Deepgram TTS were removed: neither has a key, and Deepgram's
    # configured voice was aura-asteria-en, so leaving it in the chain meant one
    # failed Indic lookup away from reading a Bhojpuri advisory in English.
    def _murf_tts():
        # Voice, locale and style all travel together from MURF_VOICES, because they
        # are one fact about the language, not three settings. A global MURF_STYLE is
        # what broke this before: styles differ per voice, and the plugin's own
        # default voice is en-US-matthew, so any lookup miss means American English.
        voice, locale, style = MURF_VOICES[bcp47_code]
        kwargs: dict[str, object] = {
            "voice": voice,
            # FALCON is the streaming catalogue this map was verified against.
            # Changing the model changes which voice ids exist.
            "model": os.getenv("MURF_MODEL", "FALCON"),
            # Buffer whole words rather than 3-char fragments to avoid choppy streaming
            "min_buffer_size": int(os.getenv("MURF_MIN_BUFFER_SIZE", "15")),
        }
        # Set only for a voice that is not native to this language: a native voice
        # infers its locale from the id and rejects a conflicting one with a 400.
        locale_override = os.getenv("MURF_LOCALE", "").strip()
        if locale_override:
            kwargs["locale"] = locale_override
        elif locale:
            kwargs["locale"] = locale
        if style:
            kwargs["style"] = style
        for env, key, cast in (("MURF_SPEED", "speed", int), ("MURF_PITCH", "pitch", int)):
            raw = os.getenv(env)
            if raw:
                kwargs[key] = cast(raw)
        # Auth is env-only: the plugin reads MURF_API_KEY itself.
        return murf_plugin.TTS(**kwargs)  # type: ignore[arg-type]

    def _sarvam_tts():
        # Plain plugin. A ReliableSarvamTTS subclass used to force streaming=False to
        # dodge WAV decode failures; the plugin now defaults to mp3 and has a working
        # WS streaming path, and the subclass was both obsolete and lying — it rebuilt
        # TTSCapabilities, dropping aligned_transcript, and advertised non-streaming
        # while still carrying a working stream(). If WAV ever matters again,
        # output_audio_codec is a constructor argument, not a subclass.
        return sarvam_plugin.TTS(
            model=os.getenv("SARVAM_TTS_MODEL", "bulbul:v2"),
            speaker=os.getenv("SARVAM_VOICE", "anushka"),
            # No SARVAM_LANGUAGE override: a pinned value here would speak Hindi to
            # a Bengali caller, which is the failure this whole gate exists to stop.
            target_language_code=bcp47_code,
            pace=float(os.getenv("SARVAM_PACE", "0.88")),
            pitch=float(os.getenv("SARVAM_PITCH", "-0.08")),
            temperature=float(os.getenv("SARVAM_TTS_TEMPERATURE", "0.42")),
            enable_preprocessing=True,
        )

    def _rime_tts():
        # Speaker and lang travel together from RIME_VOICES for the same reason
        # Murf's do: they are one fact about the caller's language. A miss KeyErrors
        # here instead of quietly becoming "astra" speaking English.
        speaker, rime_lang = RIME_VOICES[bcp47_code]
        kwargs: dict[str, object] = {
            # Named explicitly because the speaker default silently changes with it.
            "model": os.getenv("RIME_MODEL", "coda"),
            "speaker": speaker,
            "lang": rime_lang,
            # Not a tuning knob. False routes to https://users.rime.ai/v1/rime-tts and
            # turns off streaming AND aligned_transcript, so the agent buffers whole
            # utterances and has no word timestamps to cut against on barge-in.
            # True routes to wss://users-ws.rime.ai, which is the only path this
            # project can interrupt cleanly.
            "use_websocket": True,
        }
        # speed_alpha, not time_scale_factor: tts.py:161 says it is the only speed
        # param that survives the WebSocket path, and mistv2 rejects the other one.
        raw = os.getenv("RIME_SPEED_ALPHA")
        if raw:
            kwargs["speed_alpha"] = float(raw)
        # Auth is env-only: the plugin reads RIME_API_KEY and raises without it, so an
        # unset key fails init and the loop moves to the next provider.
        return rime_plugin.TTS(**kwargs)  # type: ignore[arg-type]

    def _google_tts():
        # Cloud TTS rejects API keys outright — "API keys are not supported by this
        # API", a verified 401 on 2026-08-25. GOOGLE_API_KEY here is a Gemini key and
        # authenticates the LLM only. Cloud TTS needs a service account via
        # GOOGLE_APPLICATION_CREDENTIALS, which is deliberately not in this repo.
        # Set that and google becomes selectable; until then it fails init and the
        # loop moves on.
        return google_plugin.TTS(language=bcp47_code)

    # (name, plugin, builder, languages it can speak). None = no list we verified
    # ourselves, so try it and let the provider reject what it cannot say.
    tts_chain = [
        ("murf", murf_plugin, _murf_tts, frozenset(MURF_VOICES)),
        ("rime", rime_plugin, _rime_tts, frozenset(RIME_VOICES)),
        ("sarvam", sarvam_plugin, _sarvam_tts, SARVAM_LANGS),
        ("google", google_plugin, _google_tts, None),
    ]
    candidates = tts_candidates(
        tts_chain, os.getenv("FAST_TTS_PROVIDER", "murf").strip().lower(), bcp47_code
    )

    tts = None
    for name, build in candidates:
        try:
            tts = build()
            logger.info("FAST PIPELINE TTS: %s speaking %s", name, bcp47_code)
            break
        except Exception as exc:
            logger.warning("%s TTS init failed (%s), trying next", name, exc)
    if tts is None:
        # Refusing the call is correct. The alternative — falling back to a provider
        # that has no voice for this language — logs as success and delivers either
        # silence or the wrong language to someone waiting on health advice.
        raise RuntimeError(
            f"No TTS provider can speak {bcp47_code} "
            f"(tried {', '.join(n for n, _ in candidates) or 'nothing'})"
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
    for _noisy_logger in ("hpack", "httpcore", "httpx"):
        logging.getLogger(_noisy_logger).setLevel(logging.WARNING)

    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
        ),
    )
