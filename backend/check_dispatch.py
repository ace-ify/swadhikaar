"""
Dispatch smoke test — does a worker actually join the room the edge function makes?

The failure this exists to catch: `start-voice-call` returns `dialing`, the row goes
`in_progress`, the phone rings, and the patient hears silence because no agent was
ever dispatched into the room. Every dashboard reads green. Nothing distinguishes
"working" from "broken" from the outside.

This reproduces the edge function's exact CreateRoom call — including the
`agents: [{agent_name: ""}]` explicit-dispatch config, which is the part under
suspicion — then polls the participant list to see whether an agent shows up.
No SIP, no phone, no cost.

Run the worker first, in another terminal:
    .venv/Scripts/python backend/voice_agent/agent.py dev

Then:
    .venv/Scripts/python backend/check_dispatch.py

Exit code 0 = an agent joined. 1 = nothing joined, which is the silent failure.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time

from dotenv import load_dotenv
from livekit import api

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

WAIT_SECONDS = 25
POLL_SECONDS = 1.5

# Mirrors supabase/functions/start-voice-call/index.ts. If that file changes its
# room config, change it here too or this test stops testing the real thing.
METADATA = json.dumps(
    {
        "patient_id": "00000000-0000-4000-8000-000000000000",
        "patient_name": "Dispatch Probe",
        "call_type": "follow_up",
        "language": "hindi",
        "risk_level": "Low",
    }
)


async def main() -> int:
    url = os.getenv("LIVEKIT_URL", "").strip()
    if not url:
        print("LIVEKIT_URL missing from backend/.env")
        return 2

    room_name = f"dispatch-probe-{int(time.time())}"
    lk = api.LiveKitAPI(url=url)

    try:
        await lk.room.create_room(
            api.CreateRoomRequest(
                name=room_name,
                metadata=METADATA,
                # The line under test. The edge function sends an empty agent_name;
                # whether that matches a worker registered without one is
                # undocumented, and getting it wrong dispatches nobody.
                agents=[api.RoomAgentDispatch(agent_name="", metadata=METADATA)],
            )
        )
        print(f"room created: {room_name}")
        print(f"waiting up to {WAIT_SECONDS}s for an agent to join...\n")

        deadline = time.monotonic() + WAIT_SECONDS
        while time.monotonic() < deadline:
            res = await lk.room.list_participants(
                api.ListParticipantsRequest(room=room_name)
            )
            if res.participants:
                for p in res.participants:
                    print(f"  JOINED  identity={p.identity!r} kind={p.kind} name={p.name!r}")
                print("\nPASS — dispatch works. An agent reached the room.")
                return 0
            await asyncio.sleep(POLL_SECONDS)

        print("FAIL — no participant joined in time.")
        print("\nThis is the silent failure: the room exists, a call would connect,")
        print("and the patient would hear nothing. Check, in order:")
        print("  1. Is the worker running?  .venv/Scripts/python backend/voice_agent/agent.py dev")
        print("  2. Does the worker log 'registered worker' against this LIVEKIT_URL?")
        print("  3. If the worker is up and idle, explicit dispatch with an empty")
        print("     agent_name is not matching it — drop the `agents` field from")
        print("     CreateRoom in start-voice-call and let automatic dispatch run.")
        return 1
    finally:
        try:
            await lk.room.delete_room(api.DeleteRoomRequest(room=room_name))
            print(f"cleaned up room {room_name}")
        except Exception as exc:
            print(f"(could not delete probe room {room_name}: {exc})")
        await lk.aclose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
