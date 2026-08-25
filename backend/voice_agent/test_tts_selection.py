"""Self-check for TTS provider selection — the thing that made every call silent.

MURF_VOICE defaulted to "en-IN-anisha", which is not one of Murf's 162 voices; the
API answers "400 Invalid voice_id". The plugin does not validate the voice in its
constructor, so nothing failed at startup — the selector picked Murf, logged a
healthy pipeline, and then every synthesis 400'd. All 242 patients (hindi 89,
bhojpuri 58, maithili 50, urdu 45) were queued for a call that produced no audio.

Asserts three things that were broken:
  1. every voice id and language code we ship is one the provider actually has,
  2. a provider with no voice for the call's language is skipped, not used,
  3. the preferred provider can still fall BACK, not only forward.

No network, no API keys.

Run:  .venv/Scripts/python backend/voice_agent/test_tts_selection.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent import LANGUAGE_CODES, MURF_VOICES, SARVAM_LANGS, tts_candidates

# Verified live on 2026-08-25 from GET https://api.murf.ai/v1/speech/voices.
# Hardcoded here on purpose: a test that re-fetches would need a key and would
# pass on a day the network is down. Refresh this if Murf adds locales.
MURF_REAL_IDS = {
    "hi-IN-shweta", "hi-IN-rahul", "hi-IN-amit", "hi-IN-shaan", "hi-IN-kabir",
    "hi-IN-ayushi",
    "en-IN-isha", "en-IN-arohi", "en-IN-eashwar", "en-IN-rohan", "en-IN-alia",
    "en-IN-aarav", "en-IN-priya",
    "bn-IN-arnab", "bn-IN-anwesha", "bn-IN-abhik", "bn-IN-ishani",
    "ta-IN-sarvesh", "ta-IN-suresh", "ta-IN-iniya", "ta-IN-abirami",
}


def test_shipped_voice_ids_exist():
    """The original bug: a voice id that existed only in a default argument."""
    for bcp47, voice in MURF_VOICES.items():
        assert voice in MURF_REAL_IDS, f"{voice!r} is not a real Murf voice"
        # Murf derives locale from the id, so a mismatch is a silent wrong language.
        assert voice.startswith(bcp47 + "-"), f"{voice!r} is not a {bcp47} voice"
    assert "en-IN-anisha" not in MURF_REAL_IDS, "the invented default came back"


def test_every_patient_language_reaches_a_provider():
    """Languages in the database, not the ones in the map: urdu was missing."""
    for language in ("hindi", "bhojpuri", "maithili", "urdu", "assamese"):
        bcp47 = LANGUAGE_CODES.get(language)
        assert bcp47, f"{language} has no BCP-47 mapping"
        assert bcp47 in MURF_VOICES or bcp47 in SARVAM_LANGS, (
            f"{language} -> {bcp47} has no provider"
        )


def test_no_provider_has_assamese():
    """Guard the approximation. If this ever fails, a real Assamese voice shipped
    and LANGUAGE_CODES['assamese'] should stop pointing at Bengali."""
    assert "as-IN" not in MURF_VOICES
    assert "as-IN" not in SARVAM_LANGS
    assert LANGUAGE_CODES["assamese"] == "bn-IN"


# (name, plugin, builder, langs) — the plugin only has to be non-None to count as
# installed, and tts_candidates never calls the builder.
def _chain(murf=object(), sarvam=object(), google=object()):
    return [
        ("murf", murf, lambda: "murf-tts", frozenset(MURF_VOICES)),
        ("sarvam", sarvam, lambda: "sarvam-tts", SARVAM_LANGS),
        ("google", google, lambda: "google-tts", None),
    ]


def _names(*args, **kwargs):
    return [name for name, _ in tts_candidates(*args, **kwargs)]


def test_murf_first_for_hindi():
    assert _names(_chain(), "murf", "hi-IN")[0] == "murf"


def test_language_murf_lacks_skips_to_sarvam():
    """te-IN: Sarvam has it, Murf has no Telugu voice at all."""
    assert _names(_chain(), "murf", "te-IN") == ["sarvam", "google"]


def test_assamese_routes_to_bengali_voice_on_murf():
    """The question that started this: Assamese picks bn-IN, and Murf HAS bn-IN,
    so it stays on the preferred provider rather than falling through."""
    assert _names(_chain(), "murf", LANGUAGE_CODES["assamese"])[0] == "murf"


def test_preferred_can_fall_back_not_only_forward():
    """The ordering bug: slicing the chain at the preferred index meant
    FAST_TTS_PROVIDER=sarvam could never reach murf."""
    assert _names(_chain(), "sarvam", "hi-IN") == ["sarvam", "murf", "google"]
    assert _names(_chain(), "google", "hi-IN") == ["google", "murf", "sarvam"]


def test_uninstalled_plugin_is_skipped():
    assert _names(_chain(murf=None), "murf", "hi-IN") == ["sarvam", "google"]


def test_unknown_provider_falls_back_to_murf():
    assert _names(_chain(), "elevenlabs", "hi-IN")[0] == "murf"


def test_nothing_available_yields_nothing_rather_than_english():
    """Empty is the correct answer — entrypoint raises on it. An English voice
    reading a Bhojpuri advisory logs as success and is useless to the patient."""
    assert _names(_chain(murf=None, sarvam=None, google=None), "murf", "hi-IN") == []


if __name__ == "__main__":
    passed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"  ok  {name}")
            passed += 1
    print(f"\n{passed} checks passed")
