"""Self-check for TranscriptAccumulator severity detection.

The escalation safety net fires from add() now instead of a 1s poll, so this
locks in: right severity, fires once, and only when a keyword actually appears.

    python test_transcript.py
"""

from agent import TranscriptAccumulator


def _fired(*turns: tuple[str, str]) -> list[str]:
    seen: list[str] = []
    t = TranscriptAccumulator(on_severity=seen.append)
    for role, text in turns:
        t.add(role, text)
    return seen


def main() -> None:
    assert _fired(("user", "sab theek hai")) == []
    assert _fired(("user", "mujhe seene mein dard ho raha hai")) == ["CRITICAL"]
    assert _fired(("user", "maine dawai nahi li")) == ["HIGH"]
    assert _fired(("assistant", "aap turant 108 call karein")) == ["CRITICAL"]

    # Fires once per call, even as more keywords arrive.
    assert _fired(
        ("user", "dawai nahi li"),
        ("user", "aur ab chest pain bhi hai"),
    ) == ["HIGH"]

    # CRITICAL wins when both land in the same turn.
    assert _fired(("user", "dawai nahi li, saans nahi aa rahi")) == ["CRITICAL"]

    # No callback wired -> detection flags still work, nothing blows up.
    t = TranscriptAccumulator()
    t.add("user", "chest pain")
    assert t.is_critical and not t.is_high
    assert "Patient: chest pain" in t.to_plain_text()

    print("ok")


if __name__ == "__main__":
    main()
