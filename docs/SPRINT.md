# Sprint — Swadhikaar v2 (Aug 20 → Aug 28)

Round 2 demo at IIT Guwahati. 8 days, **3 people** (Naimish, Jagrati, Harshit), one repo.

> This is the **only** sprint doc. It gets edited in place — no new plan files.

## Before anyone starts

1. **Naimish:** clean the repo, then commit + push. Nobody clones until this lands on `main`.
   Already gitignored: `EOS-inspiration/`, `EOS-TEARDOWN.md`, `pitchdeckuilive/`, `*.pdf`, `.playwright-mcp/`, `tmp.md`.
   Commit only: `supabase/**`, `README.md`, `docs/SPRINT.md`.
2. **Naimish:** create one shared Supabase **dev** project. Post `NEXT_PUBLIC_SUPABASE_URL` + anon key in the team chat.
3. Everyone: `frontend/.env.local` with those two values. Naimish also needs `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env` (note: **`.env`**, not `.env.local` — `load_dotenv()` won't find `.env.local`).

## Migrations — Naimish owns all of them

With three people there's no reason to split migration numbers. **Only Naimish creates and applies migrations.** If Harshit or Jagrati needs a column, they ask and it goes into the next file.

| File | Purpose |
|---|---|
| `004_occupational_health.sql` | occupation/crop/pesticide/district/farmer_registry_id columns, district analytics view |
| `005_call_scheduler.sql` | pg_cron job that actually places due recovery calls |
| `006_asha_role.sql` | asha/farmer roles + RLS policies |

## Work streams — split by layer, near-zero file overlap

### Stream A — Offline PWA shell · **Jagrati**
Owns:
```
frontend/src/lib/offline/*          (new)
frontend/public/manifest.json       (new)
frontend/next.config.ts             (Serwist wiring)
frontend/src/app/layout.tsx         (manifest link only — one line)
```
Use **Serwist**, not `next-pwa` (dead, breaks on Next 16). Ship the outbox contract (below) on **day 1** so Harshit can code against it immediately.

### Stream B — ASHA field screening UI · **Harshit**
Owns:
```
frontend/src/app/asha/**            (new route group)
frontend/src/components/asha/**     (new)
```
Screening form writes through Jagrati's outbox. Do **not** call Supabase directly from the form — go through `enqueue()` or offline breaks.

### Stream C — All backend · **Naimish**
Owns:
```
supabase/migrations/004_*.sql, 005_*.sql, 006_*.sql
supabase/functions/heat-advisory/**    (new)
supabase/functions/agristack-mock/**   (new)
supabase/functions/incident-complete/  (existing)
frontend/src/app/admin/seam-trigger/   (new, thin)
```
**Start with 005 (pg_cron).** Right now `scheduled_for` is written but nothing ever places those calls — the recovery protocol is inert. Highest value fix in the repo, half a day.

AgriStack has no usable public sandbox — build a mock with a documented contract and say so in the demo. Seam trigger is one form → POST to `incident-complete` → the recovery screen populates. That's the money demo.

## Two contracts — agree before coding, commit day 1

### 1. Offline outbox (Jagrati writes this file first)
```ts
// frontend/src/lib/offline/outbox.ts
export type OutboxOp = {
  id: string;              // uuid, client-generated
  table: string;           // e.g. "patients"
  op: "insert" | "update";
  payload: Record<string, unknown>;
  createdAt: string;       // ISO
};

export function enqueue(op: Omit<OutboxOp, "id" | "createdAt">): Promise<string>;
export function pending(): Promise<OutboxOp[]>;
export function syncNow(): Promise<{ synced: number; failed: number }>;
```
Everyone writing offline data uses `enqueue`. Nothing else.

### 2. New columns (Mayank writes `004` first)
```sql
ALTER TABLE patients
  ADD COLUMN occupation TEXT,             -- 'farmer' | 'field_labour' | ...
  ADD COLUMN crop_type TEXT,
  ADD COLUMN last_pesticide_exposure DATE,
  ADD COLUMN district TEXT,
  ADD COLUMN farmer_registry_id TEXT;     -- AgriStack side of the identity bridge
```
Nobody invents column names. If you need one, it goes in `004`.

## Sync rules

- **Branch per stream:** `stream/pwa`, `stream/asha`, `stream/backend`
- **Merge to `main` daily**, end of day. Never save merges for the end.
- **Never edit** `frontend/src/components/ui/*` — shared shadcn primitives.
- **Dependencies:** announce in chat before `npm install`. Jagrati owns `package.json` conflicts.
- **Only Naimish writes migrations.** Ask him for columns.
- **15-min standup daily:** what merged, what's blocked, what you're touching tomorrow.

## Day map

| Day | Jagrati · PWA | Harshit · ASHA UI | Naimish · Backend |
|---|---|---|---|
| 20 | outbox contract + manifest | route scaffold, static screens | repo cleanup, push, shared Supabase, **005 pg_cron** |
| 21 | service worker, route caching | screening form | 004 columns, 006 roles |
| 22 | IndexedDB writes | offline write via outbox | district analytics view |
| 23 | sync + conflict handling | risk display, patient list | heat-advisory function |
| 24 | offline indicator UI | voice logging screen | advisory call queue, seam trigger |
| 25 | Lighthouse pass | accessibility pass | agristack mock, verify export-abdm is real |
| 26 | low-spec device test | fixes | end-to-end test, demo script |
| 27 | freeze + buffer | freeze | rehearsal, travel |

## Cut list — do not build

- Parallel broadcast dispatch engine (3–4 d, not in the demo rubric) → seam trigger instead
- Native mobile SOS app → mockups stay mockups
- Real AgriStack integration → documented mock
- Real IMD API → OpenWeather free tier, IMD as production path
