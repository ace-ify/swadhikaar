"""Gnani.ai Sovereign Indic Speech Adapter for LiveKit Agents.

Provides first-class LiveKit STT and TTS adapters for Gnani.ai:
  - GnaniPrismaSTT: Indic-auto sub-200ms speech-to-text powered by Prisma v3.0,
    supporting Hinglish and 12+ Indic languages with automatic code-mixing.
  - GnaniTimbreTTS: Natural empathetic vernacular voice synthesis powered by Timbre v3.0,
    with native Indian currency (₹) and numeral cadence handling.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import time
import wave
from dataclasses import dataclass
from typing import Any, AsyncIterable, AsyncIterator, Optional

import aiohttp

from livekit import rtc
from livekit.agents import (
    APIConnectionError,
    APIConnectOptions,
    APIStatusError,
    APITimeoutError,
    DEFAULT_API_CONNECT_OPTIONS,
    stt,
    tts,
    utils,
)
from livekit.agents.stt import (
    SpeechData,
    SpeechEvent,
    SpeechEventType,
)

logger = logging.getLogger("swadhikaar.gnani")

GNANI_DEFAULT_STT_ENDPOINT = os.getenv("GNANI_STT_ENDPOINT", "https://api.vachana.ai/stt/v3")
GNANI_DEFAULT_TTS_ENDPOINT = os.getenv("GNANI_TTS_ENDPOINT", "https://api.vachana.ai/api/v1/tts/inference")

# Language to Gnani Timbre v3.0 Empathetic Indic Voice Mapping
GNANI_VOICES: dict[str, str] = {
    "hi-IN": "Shivani",   # Conversational Empathetic Hindi
    "en-IN": "Shivani",   # Indian English
    "ta-IN": "Lakshmi",   # Conversational Tamil
    "te-IN": "Kalpana",   # Conversational Telugu
    "kn-IN": "Prakash",   # Conversational Kannada
    "mr-IN": "Chetana",   # Conversational Marathi
    "gu-IN": "Devansh",   # Conversational Gujarati
    "bn-IN": "Riyaa",     # Conversational Bengali
    "ml-IN": "Lakshmi",   # Conversational Malayalam
    "pa-IN": "Shivani",   # Conversational Punjabi
    "as-IN": "Riyaa",     # Assamese
    "or-IN": "Riyaa",     # Odia
}

GNANI_LANGS: frozenset[str] = frozenset(GNANI_VOICES.keys())


# ---------------------------------------------------------------------------
# Gnani Timbre v3.0 TTS Adapter
# ---------------------------------------------------------------------------

class GnaniChunkedStream(tts.ChunkedStream):
    """Chunked streaming synthesis adapter for Gnani Timbre v3.0."""

    def __init__(
        self,
        *,
        tts_instance: GnaniTimbreTTS,
        input_text: str,
        conn_options: APIConnectOptions,
    ) -> None:
        super().__init__(tts=tts_instance, input_text=input_text, conn_options=conn_options)
        self._gnani_tts = tts_instance

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        text = self._input_text.strip()
        if not text:
            return

        payload = {
            "text": text,
            "voice": self._gnani_tts.voice,
            "model": self._gnani_tts.model,
            "language": self._gnani_tts.language,
            "speed": self._gnani_tts.speed,
            "audio_config": {
                "encoding": "linear_pcm",
                "container": "wav",
                "num_channels": 1,
                "sample_rate": self._gnani_tts.sample_rate,
                "sample_width": 2,
            },
        }

        headers = {
            "Content-Type": "application/json",
            "X-API-Key-ID": self._gnani_tts.api_key,
            "User-Agent": "Swadhikaar-VoiceAgent/1.0 (LiveKit)",
        }

        timeout = aiohttp.ClientTimeout(
            total=self._conn_options.timeout or 15.0,
            sock_connect=5.0,
        )

        try:
            session = self._gnani_tts._ensure_session()
            async with session.post(
                self._gnani_tts.endpoint,
                json=payload,
                headers=headers,
                timeout=timeout,
            ) as res:
                if res.status != 200:
                    err_body = await res.text()
                    logger.error("Gnani Timbre TTS HTTP %s: %s", res.status, err_body)
                    raise APIStatusError(
                        message=f"Gnani TTS returned HTTP {res.status}: {err_body}",
                        status_code=res.status,
                        body=err_body,
                    )

                audio_bytes = await res.read()
                if not audio_bytes:
                    raise APIConnectionError("Gnani Timbre TTS returned empty audio data")

                output_emitter.initialize(
                    request_id=f"gnani-{int(time.time() * 1000)}",
                    sample_rate=self._gnani_tts.sample_rate,
                    num_channels=1,
                    mime_type="audio/wav",
                )
                output_emitter.push(audio_bytes)

        except asyncio.TimeoutError as exc:
            raise APITimeoutError("Gnani Timbre TTS request timed out") from exc
        except aiohttp.ClientError as exc:
            raise APIConnectionError(f"Gnani Timbre connection error: {exc}") from exc


class GnaniTimbreTTS(tts.TTS):
    """Gnani.ai Timbre v3.0 Text-to-Speech Engine."""

    def __init__(
        self,
        *,
        model: str = "timbre-v3.0",
        voice: str = "Shivani",
        language: str = "hi-IN",
        speed: float = 1.0,
        sample_rate: int = 24000,
        api_key: Optional[str] = None,
        endpoint: Optional[str] = None,
        http_session: Optional[aiohttp.ClientSession] = None,
    ) -> None:
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=sample_rate,
            num_channels=1,
        )
        self.model = model
        self.voice = voice
        self.language = language
        self.speed = speed
        self.api_key = api_key or os.getenv("GNANI_API_KEY", "").strip()
        self.endpoint = endpoint or GNANI_DEFAULT_TTS_ENDPOINT
        self._session = http_session
        self._owns_session = False

        if not self.api_key:
            raise ValueError("GNANI_API_KEY is required for GnaniTimbreTTS")

    def _ensure_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
            self._owns_session = True
        return self._session

    async def aclose(self) -> None:
        if self._owns_session and self._session and not self._session.closed:
            await self._session.close()

    def synthesize(
        self,
        text: str,
        *,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> tts.ChunkedStream:
        return GnaniChunkedStream(
            tts_instance=self,
            input_text=text,
            conn_options=conn_options,
        )


# ---------------------------------------------------------------------------
# Gnani Prisma v3.0 STT Adapter
# ---------------------------------------------------------------------------

class GnaniSpeechStream(stt.RecognizeStream):
    """Streaming recognition stream accumulating audio chunks and decoding with Gnani Prisma v3.0."""

    def __init__(
        self,
        *,
        stt_instance: GnaniPrismaSTT,
        conn_options: APIConnectOptions,
        language: str,
    ) -> None:
        super().__init__(
            stt=stt_instance,
            conn_options=conn_options,
            sample_rate=16000,  # 16kHz standard for Gnani Prisma
        )
        self._gnani_stt = stt_instance
        self._target_language = language

    async def _run(self) -> None:
        audio_buffer = bytearray()
        sample_rate = 16000
        channels = 1
        bytes_per_sample = 2  # 16-bit PCM

        try:
            async for data in self._input_ch:
                if isinstance(data, rtc.AudioFrame):
                    audio_buffer.extend(data.data.tobytes())
                elif isinstance(data, self._FlushSentinel):
                    if len(audio_buffer) >= (sample_rate * bytes_per_sample // 4):  # At least 250ms
                        transcript = await self._transcribe_pcm(bytes(audio_buffer))
                        if transcript:
                            self._event_ch.send_nowait(
                                SpeechEvent(
                                    type=SpeechEventType.FINAL_TRANSCRIPT,
                                    alternatives=[
                                        SpeechData(
                                            language=self._target_language,
                                            text=transcript,
                                            confidence=0.98,
                                        )
                                    ],
                                )
                            )
                        audio_buffer.clear()

            # End of stream flush
            if len(audio_buffer) >= (sample_rate * bytes_per_sample // 4):
                transcript = await self._transcribe_pcm(bytes(audio_buffer))
                if transcript:
                    self._event_ch.send_nowait(
                        SpeechEvent(
                            type=SpeechEventType.FINAL_TRANSCRIPT,
                            alternatives=[
                                SpeechData(
                                    language=self._target_language,
                                    text=transcript,
                                    confidence=0.98,
                                )
                            ],
                        )
                    )
        except Exception as exc:
            logger.warning("Gnani speech stream encountered error: %s", exc)
            raise

    async def _transcribe_pcm(self, pcm_data: bytes) -> str:
        """Packages PCM into WAV container and invokes Gnani Prisma v3.0 REST STT."""
        wav_io = io.BytesIO()
        with wave.open(wav_io, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(pcm_data)
        wav_bytes = wav_io.getvalue()

        data = aiohttp.FormData()
        data.add_field(
            "audio_file",
            wav_bytes,
            filename="speech.wav",
            content_type="audio/wav",
        )
        data.add_field("language_code", self._gnani_stt.language_code)
        data.add_field("model", self._gnani_stt.model)

        headers = {
            "X-API-Key-ID": self._gnani_stt.api_key,
            "User-Agent": "Swadhikaar-VoiceAgent/1.0 (LiveKit)",
        }

        timeout = aiohttp.ClientTimeout(total=10.0, sock_connect=3.0)
        session = self._gnani_stt._ensure_session()

        try:
            async with session.post(
                self._gnani_stt.endpoint,
                data=data,
                headers=headers,
                timeout=timeout,
            ) as res:
                if res.status != 200:
                    err_text = await res.text()
                    logger.warning("Gnani Prisma STT returned HTTP %s: %s", res.status, err_text)
                    return ""

                res_json = await res.json()
                # Parse transcription text across response envelope variants
                text = (
                    res_json.get("transcript")
                    or res_json.get("text")
                    or (res_json.get("data", {}).get("transcript") if isinstance(res_json.get("data"), dict) else None)
                    or ""
                )
                return text.strip()
        except Exception as exc:
            logger.warning("Gnani Prisma transcription request error: %s", exc)
            return ""


class GnaniPrismaSTT(stt.STT):
    """Gnani.ai Prisma v3.0 Speech-to-Text Engine."""

    def __init__(
        self,
        *,
        model: str = "prisma-v3.0",
        language: str = "indic-auto",
        api_key: Optional[str] = None,
        endpoint: Optional[str] = None,
        http_session: Optional[aiohttp.ClientSession] = None,
    ) -> None:
        super().__init__(
            capabilities=stt.STTCapabilities(streaming=True, interim_results=False)
        )
        self.model = model
        self.language_code = language
        self.api_key = api_key or os.getenv("GNANI_API_KEY", "").strip()
        self.endpoint = endpoint or GNANI_DEFAULT_STT_ENDPOINT
        self._session = http_session
        self._owns_session = False

        if not self.api_key:
            raise ValueError("GNANI_API_KEY is required for GnaniPrismaSTT")

    def _ensure_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
            self._owns_session = True
        return self._session

    async def aclose(self) -> None:
        if self._owns_session and self._session and not self._session.closed:
            await self._session.close()

    def stream(
        self,
        *,
        language: Optional[str] = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> stt.RecognizeStream:
        return GnaniSpeechStream(
            stt_instance=self,
            conn_options=conn_options,
            language=language or self.language_code,
        )

    async def _recognize_impl(
        self,
        buffer: list[rtc.AudioFrame] | rtc.AudioFrame,
        *,
        language: Optional[str] = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> SpeechEvent:
        """Non-streaming single-utterance recognition implementation."""
        stream = GnaniSpeechStream(
            stt_instance=self,
            conn_options=conn_options,
            language=language or self.language_code,
        )
        # Push frames into stream
        frames = buffer if isinstance(buffer, list) else [buffer]
        for frame in frames:
            stream.push_frame(frame)
        stream.end_input()

        transcript = ""
        async for ev in stream:
            if ev.type == SpeechEventType.FINAL_TRANSCRIPT and ev.alternatives:
                transcript = ev.alternatives[0].text
                break

        return SpeechEvent(
            type=SpeechEventType.FINAL_TRANSCRIPT,
            alternatives=[
                SpeechData(
                    language=language or self.language_code,
                    text=transcript,
                    confidence=0.98 if transcript else 0.0,
                )
            ],
        )
