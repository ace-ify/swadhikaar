-- ACUTE INCIDENT LAYER — schema, as applied to the project 2026-08-26.
--
-- Applied through the Supabase MCP as 21 named migrations (incidents_core through
-- fix_search_path_must_include_public); consolidated here so the repository is not
-- behind production. That drift is a recurring bug source in this project — it is
-- what let risk-predict run v2 while git held v1 — so this file exists to close it.
--
-- The FUNCTIONS are in 002_acute_layer_functions.sql. Design rationale and the list
-- of EOS defects this port deliberately does not reproduce: docs/ACUTE_LAYER.md.

-- ---------------------------------------------------------------------- types
do $$ begin
  create type incident_status as enum (
    'pending',      -- created, nobody has accepted
    'dispatched',   -- a responder or facility has accepted
    'en_route',     -- transport is moving
    'arrived',      -- patient delivered
    'resolved',     -- closed with an outcome
    'expired',      -- aged out unattended. A real state, not a coercion artefact.
    'cancelled'     -- false alarm or stood down
  );
exception when duplicate_object then null; end $$;

-- NOTE the absence of 'blocked'. In EOS it is a dead state: their rate limiter was
-- meant to write it, they backed out because a blocked incident drops out of other
-- devices' whereIn listeners and causes MISSED ALERTS, and now nothing writes it and
-- nothing can unblock it. Suppression here is the rate_limit_flagged flag, and a
-- flagged incident still dispatches and stays visible.

do $$ begin
  create type incident_severity as enum ('critical', 'high', 'standard');
exception when duplicate_object then null; end $$;

do $$ begin
  create type triage_colour as enum ('red', 'orange', 'yellow', 'green', 'black');
exception when duplicate_object then null; end $$;

do $$ begin
  create type dispatch_state as enum (
    'offering', 'accepted', 'exhausted', 'no_candidates', 'stood_down');
exception when duplicate_object then null; end $$;

do $$ begin
  create type offer_state as enum (
    'pending', 'accepted', 'declined', 'superseded', 'timed_out');
exception when duplicate_object then null; end $$;

do $$ begin
  create type responder_kind as enum (
    'volunteer', 'asha', 'ambulance', 'facility_staff', 'doctor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type responder_state as enum (
    'accepted', 'en_route', 'on_scene', 'transporting', 'completed', 'withdrawn');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------ incidents
create table if not exists public.incidents (
  id uuid primary key default uuid_generate_v4(),
  -- Human-readable, spoken over a phone. EOS builds the same shape from a Firestore
  -- counter and falls back to a uuid when that read fails, so their ids are not
  -- uniformly shaped and a fallback id is unspeakable over a radio. A sequence
  -- cannot fail, so there is no fallback path here to get wrong.
  ref text unique not null,

  -- Nullable on purpose: an incident can exist before anyone knows who the patient
  -- is, which is the common case for a bystander call.
  patient_id uuid references public.patients(id) on delete set null,
  reporter_name text,
  reporter_phone text,
  victim_name text,
  victim_age integer check (victim_age is null or victim_age between 0 and 130),

  -- Flat numerics, like EOS, so a bounding-box prefilter can use a btree index
  -- without PostGIS.
  lat numeric(9, 6) not null,
  lon numeric(9, 6) not null,
  address text,
  district text,

  incident_type text not null,
  description text,
  severity incident_severity not null default 'standard',
  triage_colour triage_colour,
  required_services text[] not null default '{}',

  status incident_status not null default 'pending',

  -- Copied at create time rather than joined. EOS calls this privacy-by-copy; it is
  -- also right because the crew needs what was true when the incident opened, and a
  -- patient row edited an hour later must not silently rewrite the handover.
  vitals jsonb not null default '{}'::jsonb,
  medical_snapshot jsonb not null default '{}'::jsonb,

  golden_hour_start timestamptz not null default now(),

  rate_limit_flagged boolean not null default false,
  rate_limit_reason text,

  intake_source text not null default 'manual'
    check (intake_source in ('manual','sos_button','sms_relay','ivr','api','simulated')),
  is_simulated boolean not null default false,

  resolved_at timestamptz,
  resolution text,
  outcome_summary jsonb,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- EOS has no such rule and closes by deleting the row, losing the outcome entirely.
  constraint incidents_resolved_needs_reason
    check (status <> 'resolved' or (resolved_at is not null and resolution is not null))
);

create index if not exists idx_incidents_active
  on public.incidents (status, created_at desc)
  where status in ('pending','dispatched','en_route');
create index if not exists idx_incidents_location on public.incidents (lat, lon);
create index if not exists idx_incidents_patient on public.incidents (patient_id);
create index if not exists idx_incidents_ref on public.incidents (ref);
-- Golden hour is a plain index, not a generated column: timestamptz + interval is
-- only STABLE (the result depends on session TimeZone), and Postgres correctly
-- rejects it in a stored generated column.
create index if not exists idx_incidents_golden_hour
  on public.incidents (golden_hour_start)
  where status in ('pending','dispatched','en_route');

create sequence if not exists public.incident_ref_seq;

-- ------------------------------------------------------------ incident_events
create table if not exists public.incident_events (
  id uuid primary key default uuid_generate_v4(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  at timestamptz not null default now(),
  actor_uid uuid references auth.users(id) on delete set null,
  actor_role text,
  action text not null,
  from_status incident_status,
  to_status incident_status,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists idx_incident_events_incident
  on public.incident_events (incident_id, at desc);

-- ---------------------------------------------------------- incident_dispatch
-- PK is the incident id, so re-running the engine is idempotent by construction.
create table if not exists public.incident_dispatch (
  incident_id uuid primary key references public.incidents(id) on delete cascade,
  state dispatch_state not null default 'offering',
  severity incident_severity not null,

  -- Snapshotted at dispatch time rather than read live, so retuning the policy
  -- tomorrow cannot retroactively change how a live incident was meant to behave.
  parallel_per_wave integer not null,
  wave_timeout_ms integer not null,
  max_waves integer not null,

  ordered_facility_ids uuid[] not null default '{}',
  ranked_candidates jsonb not null default '[]'::jsonb,

  wave_index integer not null default 0,
  current_wave_facility_ids uuid[] not null default '{}',
  offered_facility_ids uuid[] not null default '{}',

  -- ABSOLUTE deadline. EOS derives theirs from now()-notifiedAt, so any write to
  -- notifiedAt restarts the fuse; their docs measure 45-105s latency on a 45s fuse.
  wave_started_at timestamptz,
  wave_timeout_at timestamptz,

  accepted_facility_id uuid references public.facilities(id) on delete set null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  eta_seconds integer,

  exhausted_at timestamptz,
  last_escalation_reason text,
  -- Cleared on every escalation, unlike EOS where the equivalent flag is set once and
  -- never reset, so their documented per-wave SMS fires once per incident.
  fallback_notified boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint dispatch_accepted_needs_facility
    check (state <> 'accepted' or (accepted_facility_id is not null and accepted_at is not null))
);
create index if not exists idx_dispatch_offering
  on public.incident_dispatch (state, wave_timeout_at) where state = 'offering';

-- ------------------------------------------------------------ dispatch_offers
create table if not exists public.dispatch_offers (
  id uuid primary key default uuid_generate_v4(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  wave_index integer not null,
  state offer_state not null default 'pending',

  -- Why this facility was chosen, frozen at offer time: a facility deciding whether
  -- to accept should see the same reasoning the engine used.
  rank integer not null,
  score numeric(6, 4) not null,
  distance_km numeric(7, 2) not null,
  eta_seconds integer,
  factors jsonb not null default '{}'::jsonb,

  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  responded_by uuid references auth.users(id) on delete set null,
  decline_reason text,
  superseded_by uuid references public.facilities(id) on delete set null,

  unique (incident_id, facility_id, wave_index)
);
create index if not exists idx_offers_facility_open
  on public.dispatch_offers (facility_id, state, offered_at desc);
create index if not exists idx_offers_incident on public.dispatch_offers (incident_id);

-- -------------------------------------------------------- incident_responders
-- A table, not an array plus one location slot. EOS keeps acceptedVolunteerIds[] but
-- only ONE volunteerLat/Lng pair, so a second responder overwrites the first.
create table if not exists public.incident_responders (
  id uuid primary key default uuid_generate_v4(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  responder_uid uuid references auth.users(id) on delete set null,
  responder_name text not null,
  kind responder_kind not null default 'volunteer',
  state responder_state not null default 'accepted',
  lat numeric(9, 6),
  lon numeric(9, 6),
  heading_deg integer check (heading_deg is null or heading_deg between 0 and 359),
  location_updated_at timestamptz,
  accepted_at timestamptz not null default now(),
  on_scene_at timestamptz,
  completed_at timestamptz,
  withdrawn_at timestamptz,
  notes text,
  unique (incident_id, responder_uid)
);
create index if not exists idx_responders_incident
  on public.incident_responders (incident_id, state);

-- ------------------------------------------------------- facility_reliability
-- The table EOS reads and never writes: their engine defaults rolling30dAcceptRate to
-- 0.7 when absent, and nothing in their repo populates it, so their reliability
-- factor is a constant for every hospital forever.
create table if not exists public.facility_reliability (
  facility_id uuid primary key references public.facilities(id) on delete cascade,
  accept_count integer not null default 0,
  decline_count integer not null default 0,
  timeout_count integer not null default 0,
  -- Null until there is history, so "no data" is distinguishable from "refuses
  -- everything" — a distinction EOS cannot make.
  accept_rate numeric(4, 3),
  last_offered_at timestamptz,
  last_accepted_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------ facility_staff
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('admin','doctor','asha','patient','farmer','facility_staff','dispatcher'));

-- One row per pairing, so covering two facilities on a night shift is expressible.
-- EOS uses two duplicate fields on the user document (staffHospitalId and
-- boundHospitalDocId) that every rule then has to check both of.
create table if not exists public.facility_staff (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  can_accept boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, facility_id)
);
create index if not exists idx_facility_staff_user on public.facility_staff (user_id);
create index if not exists idx_facility_staff_facility on public.facility_staff (facility_id);

-- ------------------------------------------------------- facilities additions
alter table public.facilities
  add column if not exists acute_capability text not null default 'general'
  check (acute_capability in ('general', 'speciality_only', 'not_receiving')),
  add column if not exists specialities text[] not null default '{}';

create index if not exists idx_facilities_acute_capability
  on public.facilities (acute_capability, dispatch_eligible);
create index if not exists idx_facilities_specialities
  on public.facilities using gin (specialities);
