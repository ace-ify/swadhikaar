# Swadhikaar

Swadhikaar is an Indic voice-first care operations platform for proactive patient outreach, triage, escalation, and longitudinal follow-up.

The system combines:
- realtime AI voice calls over telephony,
- Supabase-first backend architecture,
- role-based clinical operations dashboards,
- healthcare workflow tracking and audit trails.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Repository Structure](#repository-structure)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Getting Started](#getting-started)
- [Edge Functions](#edge-functions)
- [Voice Pipelines](#voice-pipelines)
- [Development Notes](#development-notes)
- [Troubleshooting](#troubleshooting)

## Overview

Swadhikaar focuses on operational reliability for health outreach programs:
- automated follow-up and reminder calls,
- multilingual patient interactions,
- escalation-aware care workflows,
- Supabase-backed state management and reporting.

## Architecture

High-level flow:
1. Frontend triggers workflows via Supabase Edge Functions.
2. Edge Functions orchestrate call setup and domain operations.
3. LiveKit worker handles live call interactions.
4. Supabase stores all durable clinical and operational state.

Core principle: **Supabase-first orchestration with a dedicated voice worker runtime**.

## Repository Structure

```text
swadhikaar/
|- frontend/               # Next.js application (patient/doctor/admin experiences)
|- backend/                # Voice worker runtime + data seed scripts
|  `- voice_agent/         # LiveKit worker, prompts, and voice pipeline logic
|- supabase/
|  |- migrations/          # Database schema migrations
|  `- functions/           # Edge Functions for orchestration
`- dataset/                # Seed data CSVs
```

## Tech Stack

- Frontend: Next.js 16, React 19, TypeScript, Tailwind
- Data + Auth + Realtime: Supabase
- Voice runtime: LiveKit Agents (Python)
- STT/TTS/LLM providers (pipeline-dependent): Deepgram, Sarvam/Cartesia, Groq, Gemini

## Prerequisites

- Node.js 20+
- Python 3.11+
- Supabase CLI
- LiveKit Cloud project
- Provider keys (as needed): Supabase, LiveKit, Google, Deepgram, Groq, optional TTS providers

## Configuration

### Frontend

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
```

### Backend worker

Create `backend/.env` from `backend/.env.example` and fill values.

Required baseline:

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
SUPABASE_KEY=<service-role-key>

LIVEKIT_URL=wss://<livekit-project>.livekit.cloud
LIVEKIT_API_KEY=<livekit-api-key>
LIVEKIT_API_SECRET=<livekit-api-secret>

GOOGLE_API_KEY=<google-api-key>
DEEPGRAM_API_KEY=<deepgram-api-key>

GROQ_API_KEY=<groq-api-key>
GROQ_MODEL=llama-3.3-70b-versatile

VOICE_PIPELINE=fast
FAST_TTS_PROVIDER=deepgram
```

Optional provider keys (only if selected):

```env
SARVAM_API_KEY=<sarvam-api-key>
CARTESIA_API_KEY=<cartesia-api-key>
```

### Supabase function secrets

Set function runtime secrets in Supabase:

```bash
supabase secrets set SUPABASE_URL="https://<project-ref>.supabase.co"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
supabase secrets set LIVEKIT_URL="wss://<livekit-project>.livekit.cloud"
supabase secrets set LIVEKIT_API_KEY="<livekit-api-key>"
supabase secrets set LIVEKIT_API_SECRET="<livekit-api-secret>"
supabase secrets set SIP_TRUNK_ID="<sip-trunk-id>"
```

## Getting Started

### 1) Install frontend dependencies

```bash
cd frontend
npm install
```

### 2) Install backend dependencies

```bash
pip install -r backend/requirements.txt
```

### 3) Link Supabase project and deploy functions

```bash
supabase link --project-ref <project-ref>
supabase functions deploy start-voice-call --no-verify-jwt
supabase functions deploy export-abdm --no-verify-jwt
supabase functions deploy triage-assess --no-verify-jwt
supabase functions deploy risk-predict --no-verify-jwt
```

### 4) Run voice worker

```bash
python backend/voice_agent/agent.py dev
```

### 5) Run frontend

```bash
cd frontend
npm run dev
```

## Edge Functions

- `start-voice-call`: room + SIP call orchestration
- `export-abdm`: ABDM export reference generation
- `triage-assess`: triage severity evaluation
- `risk-predict`: risk scoring endpoint

## Voice Pipeline

Swadhikaar runs a single production voice path:
- STT: Deepgram
- LLM: Groq primary, Gemini fallback
- TTS: provider-selectable (Sarvam/Cartesia/Deepgram)

Runtime behavior:
- `VOICE_PIPELINE` is `fast`.
- `FAST_TTS_PROVIDER` defaults to `deepgram`.
- If `GROQ_API_KEY` is missing or Groq returns `429`, the turn falls back to Gemini text LLM.

## Development Notes

- Keep only one frontend lockfile source of truth (`frontend/package-lock.json`).
- Do not commit secrets in `.env` files.
- Use UUID patient IDs for persisted entities.
- If telephony is on Twilio trial, outbound calling can be limited to verified numbers.

## Troubleshooting

- `401` on Edge Functions: deploy with `--no-verify-jwt` for non-authenticated demo paths.
- `CORS` failures: ensure functions are redeployed after header changes.
- SIP call not ringing: check trunk policy, caller ID policy, and destination country permissions.
- Groq `429`: reduce context/tokens or rely on Gemini fallback.
- Silent calls with TTS errors: inspect selected TTS provider logs and switch provider if codec mismatch occurs.
