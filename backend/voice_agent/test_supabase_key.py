"""
Self-check for the credential resolution that silently lost every voice call.

`agent.py` read SUPABASE_KEY, which .env.example ships as the literal placeholder
"your-service-role-key". It was never replaced, so every call persisted nothing and
logged one 401 line nobody read: the patient was spoken to and the transcript,
severity, escalation and journey update were all dropped.

Run:  .venv/Scripts/python backend/voice_agent/test_supabase_key.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from agent import _supabase_key, _SUPABASE_KEY_VARS  # noqa: E402


def _with(env: dict[str, str]):
    """Set exactly this env for the vars under test; clear the rest."""
    for k in _SUPABASE_KEY_VARS:
        os.environ.pop(k, None)
    os.environ.update(env)


def demo() -> None:
    # The exact bug: placeholder present, real key also present.
    _with({"SUPABASE_KEY": "your-service-role-key", "SUPABASE_SECRET_KEY": "sb_secret_real"})
    assert _supabase_key() == ("SUPABASE_SECRET_KEY", "sb_secret_real"), _supabase_key()

    # Placeholder alone must resolve to nothing, not to itself.
    _with({"SUPABASE_KEY": "your-service-role-key"})
    assert _supabase_key() == ("", ""), _supabase_key()

    # A genuine SUPABASE_KEY still works — this is not a rename.
    _with({"SUPABASE_KEY": "sb_secret_legacy"})
    assert _supabase_key() == ("SUPABASE_KEY", "sb_secret_legacy"), _supabase_key()

    # Preference order: secret beats service_role beats plain key.
    _with({
        "SUPABASE_KEY": "third",
        "SUPABASE_SERVICE_ROLE_KEY": "second",
        "SUPABASE_SECRET_KEY": "first",
    })
    assert _supabase_key()[1] == "first", _supabase_key()

    # Whitespace-only and empty are not credentials.
    _with({"SUPABASE_KEY": "   "})
    assert _supabase_key() == ("", ""), _supabase_key()

    _with({})
    assert _supabase_key() == ("", ""), _supabase_key()

    print("OK — placeholder keys are rejected, real keys win, order honoured.")


if __name__ == "__main__":
    demo()
