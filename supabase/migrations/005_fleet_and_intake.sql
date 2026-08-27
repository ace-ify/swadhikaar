-- FLEET (ambulance) LEG + INTAKE — as applied 2026-08-27.
--
-- Ported from EOS functions/index.js:2481-2953. NOT from
-- functions/src/fleet_assignments.js, which looks authoritative and is dead code:
-- never required by index.js, its `require`s sit below first use, it targets an
-- orphan collection with no security rules, and its numbers contradict production
-- (5-minute timeout, 2-minute cron, no attempt cap).
--
-- PROVENANCE. EOS's fleet units are real: each row is written by a signed-in
-- operator's device posting GPS on a ~5s heartbeat, and their dispatch reads only
-- those rows. We have no ambulance operators and no GPS feed, and EOS's repo
-- contains NO seeder — their demo units are injected out of band and their motion is
-- synthesised client-side from docId.hashCode against a wall clock, never persisted.
-- So the engine here is a faithful port; the 48 vehicles are simulated, carry
-- is_simulated = true, and the console badges them.
--
-- Numbers preserved exactly from EOS: 180s response deadline · 8 candidates on the
-- first attempt then 4 · max 4 attempts · 1-minute sweep · 90s heartbeat TTL ·
-- single-factor distance ordering · first-accept-wins · hospital acceptance gates
-- the vehicle leg.

-- ------------------------------------------------------------------ constraints
-- EOS validates coordinates with isNaN only, so x=999 is storable, and their read
-- path coerces missing coords to (0,0) — the Gulf of Guinea.
alter table public.incidents
  add constraint incidents_lat_range check (lat between -90 and 90),
  add constraint incidents_lon_range check (lon between -180 and 180);

-- ------------------------------------------------------------------------ types
do $$ begin
  create type fleet_offer_state as enum (
    'awaiting_response', 'accepted', 'rejected', 'no_response');
exception when duplicate_object then null; end $$;

do $$ begin
  create type ambulance_dispatch_state as enum (
    'pending_operator', 'en_route', 'on_scene', 'transporting', 'no_operator');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------- fleet_units
create table if not exists public.fleet_units (
  id uuid primary key default uuid_generate_v4(),
  -- Spoken over a radio, so it is the routing key, as in EOS. Their accept path
  -- upper-cases it while writes store it verbatim, so any lower-case sign 404s on
  -- accept — their own code queries three case variants as a workaround. A
  -- case-insensitive unique index removes the bug instead of working around it.
  call_sign text not null,
  operator_uid uuid references auth.users(id) on delete set null,
  vehicle_type text not null default 'medical'
    check (vehicle_type in ('medical', 'basic_transport', 'neonatal')),
  lat numeric(9, 6) check (lat is null or lat between -90 and 90),
  lon numeric(9, 6) check (lon is null or lon between -180 and 180),
  heading_deg integer check (heading_deg is null or heading_deg between 0 and 359),
  available boolean not null default true,
  assigned_incident_id uuid references public.incidents(id) on delete set null,
  stationed_facility_id uuid references public.facilities(id) on delete set null,
  driver_name text,
  phone text,
  is_simulated boolean not null default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_fleet_units_call_sign
  on public.fleet_units (lower(call_sign));
create index if not exists idx_fleet_units_dispatchable
  on public.fleet_units (stationed_facility_id, available)
  where assigned_incident_id is null;

-- ----------------------------------------------------------- fleet_assignments
create table if not exists public.fleet_assignments (
  id uuid primary key default uuid_generate_v4(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  unit_id uuid not null references public.fleet_units(id) on delete cascade,
  attempt integer not null default 0,
  state fleet_offer_state not null default 'awaiting_response',
  source text not null check (source in ('hospital_accept', 'escalation', 'manual')),
  dispatching_facility_id uuid references public.facilities(id) on delete set null,
  distance_km numeric(7, 2),
  dispatched_at timestamptz not null default now(),
  -- Absolute, and the sweeper compares against THIS. EOS's sweeper filters on
  -- dispatched_at < now()-180s while their accept path validates
  -- responseDeadlineAt, so a per-offer deadline is silently unenforceable there.
  response_deadline_at timestamptz not null,
  responded_at timestamptz,
  responded_by uuid references auth.users(id) on delete set null,
  reason text,
  unique (incident_id, unit_id, attempt)
);

create index if not exists idx_fleet_assignments_open
  on public.fleet_assignments (state, response_deadline_at)
  where state = 'awaiting_response';
create index if not exists idx_fleet_assignments_incident
  on public.fleet_assignments (incident_id, attempt desc);

alter table public.incident_dispatch
  add column if not exists ambulance_state ambulance_dispatch_state,
  add column if not exists ambulance_dispatched_at timestamptz,
  add column if not exists ambulance_attempts integer not null default 0,
  add column if not exists ambulance_notified_units uuid[] not null default '{}',
  add column if not exists assigned_unit_id uuid references public.fleet_units(id) on delete set null,
  add column if not exists ambulance_accepted_at timestamptz,
  add column if not exists ambulance_eta_seconds integer,
  add column if not exists ambulance_relay_facility_id uuid references public.facilities(id) on delete set null,
  add column if not exists ambulance_exhausted_at timestamptz;

-- ---------------------------------------------------------------- intake_events
-- Raw inbound log, written BEFORE anything is parsed. EOS answers 200 with empty
-- TwiML on an unparseable SMS and console.logs the first 100 characters, so a
-- genuine emergency their regex did not expect leaves no durable trace anywhere.
-- Their webhook_events table exists but is written only by the partner API path.
create table if not exists public.intake_events (
  id uuid primary key default uuid_generate_v4(),
  received_at timestamptz not null default now(),
  channel text not null check (channel in ('sos_button','sms_relay','ivr','api','manual')),
  payload jsonb not null,
  headers jsonb not null default '{}'::jsonb,
  caller_uid uuid references auth.users(id) on delete set null,
  source_ip text,
  outcome text not null default 'received'
    check (outcome in ('received','accepted','rejected','parse_failed','duplicate','unauthorised')),
  incident_id uuid references public.incidents(id) on delete set null,
  error text
);

create index if not exists idx_intake_events_recent on public.intake_events (received_at desc);
create index if not exists idx_intake_events_outcome
  on public.intake_events (outcome, received_at desc);

-- -------------------------------------------------------------------------- RLS
alter table public.fleet_units       enable row level security;
alter table public.fleet_assignments enable row level security;
alter table public.intake_events     enable row level security;

-- EOS's rule for the same collection is `allow write: if request.auth != null` —
-- any signed-in account can relocate, delete, or free any ambulance in the system.
drop policy if exists fleet_units_read on public.fleet_units;
create policy fleet_units_read on public.fleet_units for select to authenticated
  using (
    current_user_has_role(array['admin','dispatcher','doctor'])
    or operator_uid = auth.uid()
    or stationed_facility_id = any (current_user_facility_ids()));

drop policy if exists fleet_units_self_update on public.fleet_units;
create policy fleet_units_self_update on public.fleet_units for update to authenticated
  using (operator_uid = auth.uid() or current_user_has_role(array['admin','dispatcher']))
  with check (operator_uid = auth.uid() or current_user_has_role(array['admin','dispatcher']));

drop policy if exists fleet_units_admin on public.fleet_units;
create policy fleet_units_admin on public.fleet_units for all to authenticated
  using (current_user_has_role(array['admin']))
  with check (current_user_has_role(array['admin']));

-- Offers are engine-written; accept and reject are security-definer functions, so
-- there is no write policy and a crew cannot mark itself accepted by UPDATE.
drop policy if exists fleet_assignments_read on public.fleet_assignments;
create policy fleet_assignments_read on public.fleet_assignments for select to authenticated
  using (
    current_user_has_role(array['admin','dispatcher','doctor'])
    or dispatching_facility_id = any (current_user_facility_ids())
    or exists (select 1 from fleet_units u
                where u.id = fleet_assignments.unit_id and u.operator_uid = auth.uid()));

drop policy if exists intake_events_read_ops on public.intake_events;
create policy intake_events_read_ops on public.intake_events for select to authenticated
  using (current_user_has_role(array['admin','dispatcher']));
-- No client insert policy on intake_events: the intake function writes it with the
-- service key, which is also what lets it log a request that failed to authenticate.

-- ---------------------------------------------------- functions (in the database)
-- haversine_km, fleet_candidates, fleet_station_with_units, open_ambulance_dispatch,
-- accept_fleet_offer, reject_fleet_offer, escalate_ambulance, sweep_fleet_timeouts,
-- can_answer_for_unit, intake_rate_limit_reason, trg_open_ambulance_on_accept.
-- Recover with pg_get_functiondef; see README.md in this directory.
--
--   select cron.schedule('fleet-sweep', '* * * * *',
--     $$select public.sweep_fleet_timeouts()$$);
--
-- Divergences from EOS, each fixing something their code or docs admit:
--   * accept is ONE atomic UPDATE ... WHERE state='awaiting_response'. Theirs reads
--     the status, checks it in application code, then writes three documents outside
--     any transaction, so two operators accepting in the same tick both win.
--   * rejecting escalates once the last crew in the attempt has answered. The string
--     "rejected" appears in none of their cloud functions: eight instant refusals
--     still wait the full 180-240s.
--   * the relay to another hospital's station runs on the FIRST dispatch too. Theirs
--     only runs inside escalation, which refuses to run unless the state is already
--     pending_operator — so the one case where borrowing is most obviously needed is
--     the case where it never happens.
--   * exhaustion by attempt cap writes an audit event. Theirs is silent on exactly
--     that path while both zero-candidate paths raise an alert.
--   * candidates exclude units already on a run and beyond 60 km. Theirs has no
--     radius at all and never checks assignedIncidentId; a unit 400 km away enters
--     the list on a 999 km sentinel.
--   * one heartbeat TTL. Theirs is 45s in the client and 90s in two server files,
--     with a comment asserting they match.