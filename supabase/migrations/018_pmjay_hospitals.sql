-- 018_pmjay_hospitals.sql
-- PS-02: AB-PMJAY empanelled-hospital directory, ingested from the official
-- district-wise empanelled lists (scripts/load_pmjay_hospitals.py). Public reference
-- data: patients (including the unauthenticated kiosk) read it; only the service role
-- (ingestion script) writes it. No coordinates in the source files, so the finder is
-- district + specialty; geocoding is a later step. Applied to the live DB via the
-- Supabase MCP as migration "pmjay_hospitals".

create table if not exists public.pmjay_hospitals (
  id            uuid primary key default gen_random_uuid(),
  hospital_id   text unique not null,          -- HOSPxxxx from the district file
  name          text not null,
  hospital_type text,                           -- 'Government' | 'Private'
  specialities  text[] not null default '{}',   -- parsed from the comma list; 'Na' -> {}
  phone         text,
  email         text,
  district      text,
  state         text,
  source_url    text,
  as_on         date,                           -- freshness date from the file title
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists pmjay_hospitals_district_idx
  on public.pmjay_hospitals (state, district);
create index if not exists pmjay_hospitals_specialities_gin
  on public.pmjay_hospitals using gin (specialities);

alter table public.pmjay_hospitals enable row level security;

-- Empanelled-hospital lists are public information; anyone may read.
drop policy if exists pmjay_hospitals_read_all on public.pmjay_hospitals;
create policy pmjay_hospitals_read_all on public.pmjay_hospitals
  for select using (true);

-- Table privileges (anon table access was revoked globally elsewhere).
grant select on public.pmjay_hospitals to anon, authenticated;
