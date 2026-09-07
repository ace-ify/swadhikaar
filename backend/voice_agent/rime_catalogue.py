"""Which Rime voices exist, and which of them can actually say a clinical sentence.

Two questions, because they have different answers. The catalogue is a public JSON
file and needs no key; whether a voice survives a Hinglish sentence with a drug name
and a blood pressure reading in it needs audio. Rime's own docs warn that an invalid
voice/language pairing "may not return an error", so a 200 proves nothing here —
same lesson as Murf, where a Gen2 voice id initialised fine and 400'd at synthesis.

This is also why RIME_VOICES in agent.py ships with no Hindi row: the challenge rules
forbid copying a stale speaker list, and this project's rule is that a voice id is
proven by listening. Run this, listen to the wavs in tmp/, then add the row.

Uses tts.stream() and not tts.synthesize(). With use_websocket=True the base URL
becomes wss://users-ws.rime.ai, and ChunkedStream._run POSTs to it — so the one-shot
path is broken on exactly the config the agent ships. stream() is the shipped path.

Run:  .venv/Scripts/python backend/voice_agent/rime_catalogue.py [lang] [model]
      .venv/Scripts/python backend/voice_agent/rime_catalogue.py hin coda
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import urllib.request
import wave
from pathlib import Path

from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND / ".env")

# The Windows console is cp1252 and raises on Devanagari, so printing the fixture
# would crash the run that is meant to verify it.
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Same host as the TTS endpoint. docs.rime.ai publishes this path but 404s on it.
CATALOGUE_URL = "https://users.rime.ai/data/voices/all-v2.json"
OUT_DIR = BACKEND.parent / "tmp" / "rime"

# The sentence the product actually has to say: Devanagari Hindi carrying an English
# symptom term, a numeral read as a BP reading, and a drug name with a dose. Every
# hard case in one line — code-switch, number, and clinical vocabulary.
FIXTURE = (
    "नमस्ते। आपको chest pain कब से हो रहा है? "
    "पिछली बार BP एक सौ चालीस बटा नब्बे था। "
    "Metformin पाँच सौ मिलीग्राम दिन में दो बार लीजिए।"
)


def fetch_catalogue() -> dict:
    with urllib.request.urlopen(CATALOGUE_URL, timeout=30) as r:
        return json.load(r)


def speakers_for(catalogue: dict, model: str, lang: str) -> list[str]:
    entry = catalogue.get(model, {}).get(lang)
    if entry is None:
        return []
    if isinstance(entry, dict):  # some models nest by sub-group
        return sorted({v for group in entry.values() for v in group})
    return list(entry)


async def render(model: str, speaker: str, lang: str, text: str) -> dict:
    """Synthesise through the plugin and time what a caller would wait for."""
    from livekit.agents import APIConnectOptions
    from livekit.plugins import rime

    tts = rime.TTS(model=model, speaker=speaker, lang=lang, use_websocket=True)
    # max_retry=0: a bad voice should print one line, not the same traceback four
    # times. The agent keeps the default retries; this is a probe.
    stream = tts.stream(conn_options=APIConnectOptions(max_retry=0, timeout=30.0))
    stream.push_text(text)
    stream.flush()
    stream.end_input()

    t0 = time.perf_counter()
    ttfb = None
    frames, pcm = 0, bytearray()
    sample_rate, channels = 0, 1
    try:
        async for ev in stream:
            if ttfb is None:
                ttfb = time.perf_counter() - t0
            frames += 1
            pcm += bytes(ev.frame.data)
            sample_rate = ev.frame.sample_rate
            channels = ev.frame.num_channels
    finally:
        await stream.aclose()
    total = time.perf_counter() - t0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / f"{model}-{lang}-{speaker}.wav"
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels or 1)
        w.setsampwidth(2)  # plugin emits 16-bit PCM
        w.setframerate(sample_rate or 22050)
        w.writeframes(bytes(pcm))

    audio_s = len(pcm) / (2 * (sample_rate or 22050) * (channels or 1))
    return {
        "speaker": speaker,
        "ttfb": ttfb,
        "total": total,
        "audio_s": audio_s,
        "frames": frames,
        "path": path,
    }


async def main() -> int:
    lang = sys.argv[1] if len(sys.argv) > 1 else "hin"
    model = sys.argv[2] if len(sys.argv) > 2 else "coda"
    only = sys.argv[3] if len(sys.argv) > 3 else None

    if not os.getenv("RIME_API_KEY"):
        print("RIME_API_KEY is not set in backend/.env — catalogue only, no audio.\n")

    catalogue = fetch_catalogue()
    print(f"live catalogue: {CATALOGUE_URL}")
    print(f"models: {', '.join(catalogue)}")
    print(f"{model} languages: {', '.join(catalogue.get(model, {}))}\n")

    candidates = speakers_for(catalogue, model, lang)
    if not candidates:
        print(f"{model} has no {lang} voices. Nothing to verify.")
        return 1
    print(f"{model}/{lang}: {len(candidates)} voices -> {candidates}\n")

    if only:
        if only not in candidates:
            print(f"{only!r} is not in the live catalogue for {model}/{lang}.")
            return 1
        candidates = [only]

    if not os.getenv("RIME_API_KEY"):
        return 0

    print(f"fixture: {FIXTURE}\n")
    # The plugins borrow the agent worker's aiohttp session, which does not exist in a
    # plain script. Without this the WS open fails with "http session outside of a job
    # context" for every voice and looks like an auth problem.
    from livekit.agents.utils import http_context

    ok = 0
    async with http_context.open():
        for i, speaker in enumerate(candidates):
            # Back-to-back WS connects get 502'd by the gateway. Rendering the three
            # Hindi voices in a tight loop failed "nadi" every time and passing it
            # alone succeeded, which reads as a broken voice until you space them out.
            if i:
                await asyncio.sleep(3)
            try:
                r = await render(model, speaker, lang, FIXTURE)
            except Exception as exc:
                print(f"  FAIL {speaker:<10} {type(exc).__name__}: {exc}")
                continue
            ok += 1
            print(
                f"  ok   {r['speaker']:<10} ttfb {r['ttfb']:.2f}s  total {r['total']:.2f}s  "
                f"audio {r['audio_s']:.2f}s  {r['frames']} frames  -> {r['path'].name}"
            )

    print(f"\n{ok}/{len(candidates)} rendered. Listen before adding a row to RIME_VOICES:")
    print(f"  {OUT_DIR}")
    print("A 200 is not proof — Rime does not always error on a bad voice/lang pair.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
