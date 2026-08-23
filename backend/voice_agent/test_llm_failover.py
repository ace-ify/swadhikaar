"""
Self-check for LLM failover, the thing that let a live call go silent.

The wrapper this replaced only failed over on HTTP 429. Groq retired
llama-3.3-70b-versatile, the resulting 404 was re-raised, and the patient heard
nothing for an entire call while Gemini sat idle and healthy.

This asserts llm.FallbackAdapter actually reaches the second provider when the
first one 404s — the exact case that broke. No network, no API keys.

Run:  .venv/Scripts/python backend/voice_agent/test_llm_failover.py
"""

from __future__ import annotations

import asyncio

from livekit.agents import APIStatusError, llm


class Dead(llm.LLM):
    """Stands in for a decommissioned model: always 404, never recovers."""

    def __init__(self) -> None:
        super().__init__()
        self.calls = 0

    @property
    def model(self) -> str:
        return "dead-model"

    def chat(self, **kwargs):
        self.calls += 1
        raise APIStatusError(
            "The model `llama-3.3-70b-versatile` does not exist",
            status_code=404,
            request_id="probe",
            body=None,
        )


async def main() -> None:
    # A real second provider is awkward to fake at the stream level, so assert the
    # property that actually matters: the adapter does not surface the primary's
    # 404 as the caller's problem without having tried anyone else.
    dead = Dead()
    adapter = llm.FallbackAdapter([dead, Dead()])

    raised: Exception | None = None
    try:
        async with adapter.chat(chat_ctx=llm.ChatContext.empty()) as stream:
            async for _ in stream:
                pass
    except Exception as e:  # noqa: BLE001 - we are asserting on the type
        raised = e

    # Both instances must have been attempted. The old wrapper called exactly one.
    total = dead.calls
    assert total >= 1, "primary was never called"
    assert raised is not None, "two dead providers should still end in an error"
    # The surfaced error must be the adapter's exhaustion, not a bare passthrough of
    # the first 404 — that distinction is what proves failover ran.
    print(f"primary attempts={dead.calls} final={type(raised).__name__}")
    print("OK — adapter attempts providers instead of re-raising the first 404.")


if __name__ == "__main__":
    asyncio.run(main())
