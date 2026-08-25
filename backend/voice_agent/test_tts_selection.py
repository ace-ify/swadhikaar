"""Self-check for TTS provider and voice selection.

This file exists because of a specific mistake. Murf serves two voice libraries:
GET /v1/speech/voices returns 162 "Gen2" studio voices, and
GET /v1/speech/voices?model=FALCON returns 117 streaming voices. They barely
overlap. The LiveKit plugin defaults to model="FALCON", so FALCON is the only list
that describes what this agent can say.

Querying the unfiltered endpoint led to declaring the working voice en-IN-anisha
non-existent and replacing it with three Gen2 voices — hi-IN-shweta, en-IN-priya,
bn-IN-anwesha — which answer 400 on the streaming path. Since neither Murf nor
Deepgram validates its arguments in the constructor, that broke nothing at startup
and everything at synthesis. So this asserts against the FALCON catalogue only.

Every id below was confirmed by synthesising real audio through the plugin, not by
reading a docs page.

No network, no API keys.

Run:  .venv/Scripts/python backend/voice_agent/test_tts_selection.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agent import LANGUAGES, MURF_VOICES, SARVAM_LANGS, tts_candidates

# GET /v1/speech/voices?model=FALCON on 2026-08-25 — the streaming catalogue.
# Hardcoded on purpose: a test that re-fetched would need a key and would pass on a
# day the network was down. Refresh if Murf changes the FALCON library.
FALCON_IDS = {
    "en-IN-anisha", "en-IN-samar", "en-IN-nikhil", "en-IN-abhinav", "en-IN-pooja",
    "en-IN-anusha",
    "hi-IN-khyati", "hi-IN-karan", "hi-IN-namrita", "hi-IN-sunaina", "hi-IN-aman",
    "hi-IN-ayushi",
    "bn-IN-subhankar", "bn-IN-ishani", "bn-IN-debarati",
    "gu-IN-diya", "gu-IN-hardik",
    "kn-IN-harshitha", "ml-IN-nimisha", "ml-IN-madhavan",
    "mr-IN-vaibhav", "mr-IN-prathamesh", "mr-IN-prajakta",
    "pa-IN-harman", "pa-IN-harpreet",
    "ta-IN-iniya", "ta-IN-abirami", "ta-IN-karthikeyan",
}

# Gen2-only ids. Accepted by the constructor, 400 at synthesis under FALCON.
GEN2_ONLY = {"hi-IN-shweta", "en-IN-priya", "bn-IN-anwesha", "ta-IN-sarvesh"}

# supportedLocales for en-IN-anisha, from the same FALCON response.
ANISHA_LOCALES = {
    "as-IN", "bn-IN", "en-IN", "hi-IN", "hi-LATN", "kn-IN", "ml-IN", "mr-IN",
    "or-IN", "pa-IN", "ta-IN", "te-IN",
}

# Languages Deepgram nova-3 lists. Assamese is absent, Urdu is present.
DEEPGRAM_LANGS = {
    "en-IN", "hi", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa", "ur",
}


def test_no_gen2_voice_is_shipped():
    """The regression this file was written for."""
    for bcp47, (voice, _, _) in MURF_VOICES.items():
        assert voice not in GEN2_ONLY, (
            f"{bcp47} -> {voice!r} is a Gen2 voice; it 400s on the FALCON path"
        )
        assert voice in FALCON_IDS, f"{voice!r} is not in the FALCON catalogue"


def test_multi_locale_voices_actually_carry_the_locale():
    """A locale the voice does not support is a hard 400, so it cannot be a guess."""
    for bcp47, (voice, locale, _) in MURF_VOICES.items():
        if locale is None:
            # Native voice: Murf derives the locale from the id, so a mismatch would
            # be a silent wrong language rather than an error.
            assert voice.startswith(bcp47 + "-"), (
                f"{voice!r} is not native to {bcp47} and needs an explicit locale"
            )
            continue
        assert locale == bcp47, f"{bcp47} mapped to locale {locale}"
        if voice == "en-IN-anisha":
            assert locale in ANISHA_LOCALES, f"anisha does not carry {locale}"


def test_style_is_per_voice_not_global():
    """anisha advertises "Conversation"; most FALCON voices say "Conversational".
    One global MURF_STYLE applied to every voice is the bug this replaced."""
    assert MURF_VOICES["hi-IN"][2] == "Conversation"      # via anisha
    assert MURF_VOICES["gu-IN"][2] == "Conversational"    # native gu voice
    styles = {s for _, _, s in MURF_VOICES.values()}
    assert len(styles) > 1, "a single style for every voice is the old mistake"


def test_assamese_is_real_not_a_bengali_stand_in():
    """Murf FALCON has an as-IN voice, verified as 6.37s of Assamese audio, so the
    advisory is genuinely in Assamese. If this fails, someone reintroduced the
    bn-IN approximation."""
    stt, tts = LANGUAGES["assamese"]
    assert tts == "as-IN", "Assamese TTS must not fall back to Bengali"
    assert "as-IN" in MURF_VOICES
    # ...but Deepgram has no Assamese, so comprehension does degrade to Bengali.
    assert stt == "bn"
    assert "as" not in DEEPGRAM_LANGS


def test_stt_language_is_one_deepgram_actually_has():
    """Deriving the STT code by chopping the TTS one sent "as" to a model with no
    Assamese, and "hi" to Urdu speakers Deepgram transcribes natively."""
    for language, (stt, _) in LANGUAGES.items():
        assert stt in DEEPGRAM_LANGS, f"{language} -> STT {stt!r} is unsupported"
    assert LANGUAGES["urdu"][0] == "ur", "Deepgram has Urdu; use it"
    assert LANGUAGES["urdu"][1] == "hi-IN", "no provider has an Urdu voice"


def test_every_patient_language_reaches_a_voice():
    """The languages in the database, not the ones in the map."""
    for language in ("hindi", "bhojpuri", "maithili", "urdu", "assamese"):
        stt, tts = LANGUAGES[language]
        assert tts in MURF_VOICES or tts in SARVAM_LANGS, f"{language} has no voice"


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


def test_assamese_has_only_murf():
    """Sarvam has no Assamese, so it must be skipped rather than used with a
    Bengali voice. google carries no verified list, so it stays as a last resort."""
    assert "as-IN" not in SARVAM_LANGS
    assert _names(_chain(), "murf", "as-IN") == ["murf", "google"]


def test_language_murf_lacks_skips_to_sarvam():
    """Sarvam's od-IN is the one code Murf does not answer to — it spells the same
    language or-IN."""
    assert "od-IN" in SARVAM_LANGS and "od-IN" not in MURF_VOICES
    assert _names(_chain(), "murf", "od-IN") == ["sarvam", "google"]


def test_preferred_can_fall_back_not_only_forward():
    """The ordering bug: slicing the chain at the preferred index meant
    FAST_TTS_PROVIDER=sarvam could never reach murf."""
    assert _names(_chain(), "sarvam", "hi-IN") == ["sarvam", "murf", "google"]
    assert _names(_chain(), "google", "hi-IN") == ["google", "murf", "sarvam"]


def test_uninstalled_plugin_is_skipped():
    assert _names(_chain(murf=None), "murf", "hi-IN") == ["sarvam", "google"]


def test_unknown_provider_falls_back_to_murf():
    assert _names(_chain(), "elevenlabs", "hi-IN")[0] == "murf"


def test_nothing_available_yields_nothing_rather_than_wrong_language():
    """Empty is the correct answer — entrypoint raises on it. A provider used with
    the wrong language logs as success and delivers nothing useful to the patient."""
    assert _names(_chain(murf=None, sarvam=None, google=None), "murf", "hi-IN") == []


if __name__ == "__main__":
    passed = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"  ok  {name}")
            passed += 1
    print(f"\n{passed} checks passed")
