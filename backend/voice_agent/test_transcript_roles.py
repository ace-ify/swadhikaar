"""
Self-check for the transcript, which manufactured false CRITICAL escalations.

on_exit() filed every non-user chat item as "assistant", so the SYSTEM PROMPT was
recorded as agent speech and keyword-scanned. That prompt enumerates the escalation
triggers ("chest pain", "breathlessness", "108 call karein"), so the monitor fired
on the agent's own instructions and EVERY call produced a CRITICAL escalation.
Three reached production before this was found.

Run:  .venv/Scripts/python backend/voice_agent/test_transcript_roles.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from agent import TranscriptAccumulator  # noqa: E402
from prompts.system_prompts import build_system_prompt, DEFAULT_CONTEXT  # noqa: E402


def demo() -> None:
    # The real system prompt — not a stand-in, so this stays true if the prompt
    # wording changes.
    prompt = build_system_prompt("screening_to_opd", DEFAULT_CONTEXT)
    assert "chest pain" in prompt.lower(), "prompt no longer names the triggers"

    # 1. A system prompt must not be scannable as speech.
    t = TranscriptAccumulator()
    t.add("system", prompt)
    assert t.turns == [], "system prompt must never enter the transcript"
    assert not t.is_critical, "the prompt's own keywords must not escalate"
    assert not t.is_high

    # 2. An unknown role is rejected too, not silently coerced.
    t2 = TranscriptAccumulator()
    t2.add("developer", prompt)
    t2.add("tool", "escalate_patient -> CRITICAL")
    assert t2.turns == []
    assert not t2.is_critical

    # 3. A real patient report still escalates — the fix must not deafen the monitor.
    fired: list[str] = []
    t3 = TranscriptAccumulator(on_severity=fired.append)
    t3.add("user", "Mujhe seene mein dard ho raha hai")
    assert t3.is_critical, "a real critical symptom must still fire"
    assert fired == ["CRITICAL"]

    # 4. Real agent advice still escalates.
    t4 = TranscriptAccumulator()
    t4.add("assistant", "Aap turant 108 call karein")
    assert t4.is_critical

    # 5. A quiet call stays quiet — no escalation from nothing.
    t5 = TranscriptAccumulator()
    t5.add("user", "Main theek hoon ji, dhanyavaad")
    t5.add("assistant", "Bahut accha, apna dhyan rakhein")
    assert not t5.is_critical, f"quiet call escalated: {t5.turns}"
    assert not t5.is_high

    print("OK — prompts cannot escalate, real symptoms and real advice still do.")


if __name__ == "__main__":
    demo()
