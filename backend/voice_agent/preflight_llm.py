"""
Pre-flight check for the configured LLM. Catches the two ways a model choice makes
a live call go silent.

Both have now happened in production:
  1. llama-3.3-70b-versatile was retired -> 404 on every turn.
  2. groq/compound-mini replaced it and answers Hindi beautifully, but returns
     400 "`tool calling` is not supported with this model" — and this agent has five
     function tools, so every turn failed. The patient heard nothing.

(2) survived a manual Hindi test because that test sent no tool schema. This sends
one, because the agent always does.

Run before a demo, or after ever touching GROQ_MODEL:
    .venv/Scripts/python backend/voice_agent/preflight_llm.py
Exit 0 = the configured model can carry a call.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

from dotenv import load_dotenv

# Windows consoles default to cp1252 and cannot print Devanagari — the whole point of
# this check is reading Hindi output, so it must not die trying to show it.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# Mirrors the shape agent.py's @llm.function_tool decorators generate. Only the
# presence of a tool schema matters here, not the exact tool.
TOOL_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "escalate_patient",
            "description": "Escalate a patient reporting dangerous symptoms",
            "parameters": {
                "type": "object",
                "properties": {
                    "severity": {"type": "string", "enum": ["CRITICAL", "HIGH"]},
                    "reason": {"type": "string"},
                },
                "required": ["severity", "reason"],
            },
        },
    }
]

SYSTEM = (
    "Aap Swadhikaar ki Hindi health assistant hain. Sirf Hindi mein, 2 chhoti line "
    "mein jawab dein."
)


def _chat(model: str, key: str, utterance: str) -> dict:
    body = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": utterance},
            ],
            "tools": TOOL_SCHEMA,
            "max_tokens": 1024,
            "temperature": 0.5,
        }
    ).encode()
    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "swadhikaar-preflight",
        },
    )
    return json.load(urllib.request.urlopen(req))["choices"][0]["message"]


def main() -> int:
    key = os.getenv("GROQ_API_KEY", "").strip()
    model = os.getenv("GROQ_MODEL", "").strip()
    if not key:
        print("GROQ_API_KEY not set — the agent would run on the fallback only.")
        return 2
    print(f"model: {model or '(unset — agent default)'}\n")

    failures: list[str] = []

    # 1. Tools must be accepted at all. This is the check that was missing.
    try:
        msg = _chat(model, key, "Mujhe seene mein bahut tez dard ho raha hai")
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:200]
        print(f"FAIL  model rejected a request carrying tool schemas:\n      {detail}")
        print("\n      Every turn of a real call would fail this way and the patient")
        print("      would hear silence. Pick a tool-capable model.")
        return 1

    if msg.get("tool_calls"):
        print("PASS  tool calling works — model chose escalate_patient for chest pain")
    else:
        # Not fatal: the model may answer in speech instead. Report it, do not fail.
        print("WARN  tools accepted but not used for a clear CRITICAL symptom;")
        print("      the keyword monitor in agent.py is the safety net for this")

    # 2. It must produce speakable text when NOT calling a tool. Empty content with
    #    no tool call is the reasoning-model trap: TTS gets nothing.
    for label, utterance in (
        ("greeting", "Namaste! Aap kaise hain?"),
        ("smalltalk", "Main theek hoon ji"),
    ):
        m = _chat(model, key, utterance)
        content = (m.get("content") or "").strip()
        if m.get("tool_calls"):
            continue  # a tool call instead of speech is legitimate here
        if not content:
            failures.append(f"{label}: empty content and no tool call -> TTS silence")
            print(f"FAIL  {label}: empty content, nothing for TTS to speak")
        elif "<think" in content:
            failures.append(f"{label}: leaks <think> into content")
            print(f"FAIL  {label}: leaks reasoning into content — TTS would read it aloud")
        else:
            print(f"PASS  {label}: {content[:70]}")

    if failures:
        print(f"\n{len(failures)} problem(s) — this model would break a live call.")
        return 1
    print("\nOK — the configured model can carry a call.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
