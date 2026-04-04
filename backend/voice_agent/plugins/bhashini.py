"""
Bhashini API Integration for Swadhikaar
Uses ULCA (Universal Language Contribution API) endpoints

Bhashini is free, govt-backed, and supports all major Indian languages.
Used for STT (speech-to-text) and TTS (text-to-speech).

API Docs: https://bhashini.gitbook.io/bhashini-apis/
Dashboard: https://bhashini.gov.in/ulca/model/explore-models

Environment variables required:
    BHASHINI_API_KEY   — from ULCA dashboard
    BHASHINI_USER_ID   — from ULCA dashboard
"""

import asyncio
import base64
import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("swadhikaar.bhashini")

# ---------------------------------------------------------------------------
# Bhashini API endpoints
# ---------------------------------------------------------------------------
BHASHINI_CONFIG_URL = (
    "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline"
)
BHASHINI_INFERENCE_URL = (
    "https://dhruva-api.bhashini.gov.in/services/inference/pipeline"
)

# Default public pipeline ID (works without account for basic tasks)
DEFAULT_PIPELINE_ID = "64392f96daac500b55c543cd"

# Languages supported natively by Bhashini (BCP-47 → ISO 639-1 mapping)
LANGUAGE_MAP: dict[str, str] = {
    "hi-IN": "hi",   # Hindi
    "bn-IN": "bn",   # Bengali
    "ta-IN": "ta",   # Tamil
    "te-IN": "te",   # Telugu
    "mr-IN": "mr",   # Marathi
    "gu-IN": "gu",   # Gujarati
    "kn-IN": "kn",   # Kannada
    "ml-IN": "ml",   # Malayalam
    "pa-IN": "pa",   # Punjabi
    "or-IN": "or",   # Odia
    "as-IN": "as",   # Assamese
    "ur-IN": "ur",   # Urdu
    "en-IN": "en",   # English (Indian)
    # Dialects fallback to closest standard language
    "bho-IN": "hi",  # Bhojpuri → Hindi STT/TTS
    "mai-IN": "hi",  # Maithili → Hindi STT/TTS (Bhashini has experimental support)
}

# Gender values accepted by Bhashini TTS
GENDER_MAP = {
    "female": "female",
    "male": "male",
    "f": "female",
    "m": "male",
}


class BhashiniError(Exception):
    """Raised when Bhashini API returns an unexpected response."""


class BhashiniClient:
    """
    Async client for the Bhashini ULCA inference pipeline.

    Usage pattern:
        client = BhashiniClient()
        text = await client.speech_to_text(audio_bytes, source_language="hi")
        audio = await client.text_to_speech("Namaste!", target_language="hi")
        await client.close()

    The client lazily fetches pipeline configuration on first use and caches
    it per (language, task_type) pair so subsequent calls are fast.
    """

    def __init__(self) -> None:
        self.api_key: str = os.getenv("BHASHINI_API_KEY", "")
        self.user_id: str = os.getenv("BHASHINI_USER_ID", "")
        self._http = httpx.AsyncClient(timeout=30.0)
        # Cache: (language_code, task_type) → pipeline config dict
        self._config_cache: dict[tuple[str, str], dict] = {}
        self._config_lock = asyncio.Lock()

        if not self.api_key or not self.user_id:
            logger.warning(
                "BHASHINI_API_KEY / BHASHINI_USER_ID not set. "
                "Bhashini calls will use the public pipeline (rate-limited)."
            )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def speech_to_text(
        self,
        audio_content: bytes,
        source_language: str = "hi",
        audio_format: str = "wav",
        sampling_rate: int = 16000,
    ) -> Optional[str]:
        """
        Transcribe speech audio to text using Bhashini ASR.

        Args:
            audio_content:   Raw audio bytes (WAV/FLAC preferred).
            source_language: ISO 639-1 code, e.g. "hi" for Hindi.
            audio_format:    "wav" | "flac" | "mp3".
            sampling_rate:   Audio sampling rate in Hz.

        Returns:
            Transcribed string, or None on failure.
        """
        lang = _normalize_language(source_language)
        config = await self._get_pipeline_config(lang, "asr")
        if not config:
            logger.error("No Bhashini ASR config available for language '%s'", lang)
            return None

        service_id, callback_url, inference_key = _extract_pipeline_params(config)
        audio_b64 = base64.b64encode(audio_content).decode("utf-8")

        payload = {
            "pipelineTasks": [
                {
                    "taskType": "asr",
                    "config": {
                        "language": {"sourceLanguage": lang},
                        "serviceId": service_id,
                        "audioFormat": audio_format,
                        "samplingRate": sampling_rate,
                    },
                }
            ],
            "inputData": {
                "audio": [{"audioContent": audio_b64}],
            },
        }

        try:
            resp = await self._http.post(
                callback_url or BHASHINI_INFERENCE_URL,
                json=payload,
                headers=_inference_headers(inference_key),
                timeout=30.0,
            )
            resp.raise_for_status()
            result = resp.json()
            text = (
                result.get("pipelineResponse", [{}])[0]
                .get("output", [{}])[0]
                .get("source", "")
            )
            logger.debug("Bhashini ASR result: %s", text)
            return text.strip() or None
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Bhashini STT HTTP error %s: %s", exc.response.status_code, exc.response.text
            )
            return None
        except Exception as exc:
            logger.error("Bhashini STT failed: %s", exc)
            return None

    async def text_to_speech(
        self,
        text: str,
        target_language: str = "hi",
        gender: str = "female",
        sampling_rate: int = 16000,
    ) -> Optional[bytes]:
        """
        Synthesise speech audio from text using Bhashini TTS.

        Args:
            text:            Input text (Hindi / Indic script or transliterated).
            target_language: ISO 639-1 code, e.g. "hi" for Hindi.
            gender:          "female" or "male".
            sampling_rate:   Target audio sampling rate.

        Returns:
            WAV audio as bytes, or None on failure.
        """
        lang = _normalize_language(target_language)
        config = await self._get_pipeline_config(lang, "tts")
        if not config:
            logger.error("No Bhashini TTS config available for language '%s'", lang)
            return None

        service_id, callback_url, inference_key = _extract_pipeline_params(config)
        gender_str = GENDER_MAP.get(gender.lower(), "female")

        payload = {
            "pipelineTasks": [
                {
                    "taskType": "tts",
                    "config": {
                        "language": {"sourceLanguage": lang},
                        "serviceId": service_id,
                        "gender": gender_str,
                        "samplingRate": sampling_rate,
                    },
                }
            ],
            "inputData": {
                "input": [{"source": text}],
            },
        }

        try:
            resp = await self._http.post(
                callback_url or BHASHINI_INFERENCE_URL,
                json=payload,
                headers=_inference_headers(inference_key),
                timeout=30.0,
            )
            resp.raise_for_status()
            result = resp.json()
            audio_b64 = (
                result.get("pipelineResponse", [{}])[0]
                .get("audio", [{}])[0]
                .get("audioContent", "")
            )
            if audio_b64:
                return base64.b64decode(audio_b64)
            logger.warning("Bhashini TTS returned empty audio for text: %s", text[:60])
            return None
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Bhashini TTS HTTP error %s: %s", exc.response.status_code, exc.response.text
            )
            return None
        except Exception as exc:
            logger.error("Bhashini TTS failed: %s", exc)
            return None

    async def is_available(self) -> bool:
        """Quick health check — returns True if Bhashini API is reachable."""
        try:
            resp = await self._http.get(
                "https://dhruva-api.bhashini.gov.in/",
                timeout=5.0,
            )
            return resp.status_code < 500
        except Exception:
            return False

    async def close(self) -> None:
        """Close the underlying HTTP session."""
        await self._http.aclose()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _get_pipeline_config(
        self, language: str, task_type: str
    ) -> Optional[dict]:
        """
        Fetch and cache the Bhashini pipeline config for a given (language, task).
        Returns the raw config response dict, or None on failure.
        """
        cache_key = (language, task_type)
        if cache_key in self._config_cache:
            return self._config_cache[cache_key]

        async with self._config_lock:
            # Double-checked locking
            if cache_key in self._config_cache:
                return self._config_cache[cache_key]

            config = await self._fetch_pipeline_config(language, task_type)
            if config:
                self._config_cache[cache_key] = config
            return config

    async def _fetch_pipeline_config(
        self, language: str, task_type: str
    ) -> Optional[dict]:
        """Make the actual network request to fetch pipeline configuration."""
        payload = {
            "pipelineTasks": [
                {
                    "taskType": task_type,
                    "config": {
                        "language": {"sourceLanguage": language},
                    },
                }
            ],
            "pipelineRequestConfig": {
                "pipelineId": DEFAULT_PIPELINE_ID,
            },
        }
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if self.user_id:
            headers["userID"] = self.user_id
        if self.api_key:
            headers["ulcaApiKey"] = self.api_key

        try:
            resp = await self._http.post(
                BHASHINI_CONFIG_URL,
                json=payload,
                headers=headers,
                timeout=15.0,
            )
            resp.raise_for_status()
            data = resp.json()
            logger.debug(
                "Bhashini pipeline config fetched for %s/%s", language, task_type
            )
            return data
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Bhashini config HTTP error %s for %s/%s: %s",
                exc.response.status_code,
                language,
                task_type,
                exc.response.text,
            )
            return None
        except Exception as exc:
            logger.error(
                "Bhashini config fetch failed for %s/%s: %s", language, task_type, exc
            )
            return None


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


def _normalize_language(lang: str) -> str:
    """
    Accept either BCP-47 ("hi-IN") or ISO 639-1 ("hi") codes.
    Returns the ISO 639-1 code Bhashini expects.
    Falls back to "hi" (Hindi) for unknown codes.
    """
    # Already ISO 639-1 short code
    if len(lang) == 2:
        return lang
    # BCP-47 → ISO via map
    if lang in LANGUAGE_MAP:
        return LANGUAGE_MAP[lang]
    # Best-effort: take the first two chars ("hi" from "hi-IN")
    return lang[:2] if lang else "hi"


def _extract_pipeline_params(config: dict) -> tuple[str, str, str]:
    """
    Extract serviceId, callbackUrl, and inferenceApiKey from a pipeline config
    response.  Returns ("", "", "") if the structure is unexpected so callers
    can handle gracefully.
    """
    try:
        pipeline_responses = config.get("pipelineResponseConfig", [])
        if not pipeline_responses:
            return "", "", ""

        first_config = pipeline_responses[0].get("config", [])
        if not first_config:
            return "", "", ""

        service_id: str = first_config[0].get("serviceId", "")
        endpoint = config.get("pipelineInferenceAPIEndPoint", {})
        callback_url: str = endpoint.get("callbackUrl", BHASHINI_INFERENCE_URL)
        inference_key: str = (
            endpoint.get("inferenceApiKey", {}).get("value", "")
        )
        return service_id, callback_url, inference_key
    except (IndexError, KeyError, TypeError) as exc:
        logger.error("Failed to extract pipeline params: %s", exc)
        return "", "", ""


def _inference_headers(inference_key: str) -> dict[str, str]:
    """Build headers for inference API calls."""
    headers = {"Content-Type": "application/json"}
    if inference_key:
        headers["Authorization"] = inference_key
    return headers
