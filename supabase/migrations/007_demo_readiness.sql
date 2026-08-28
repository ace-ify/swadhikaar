-- DEMO READINESS — as applied 2026-08-28 (demo morning).
--
-- Three fixes, all found while making the acute layer actually demonstrable.

-- 1 -------------------------------------------------------------------------
-- grant_app_role knew five roles and facility_staff was not one of them, so the only
-- way to set up a receiving-hospital login was two hand-written inserts. A
-- facility_staff account needs BOTH rows or it fails silently: the role decides which
-- portal renders, the facility_staff row decides which offers RLS returns and whether
-- accept_dispatch_offer will answer for that hospital at all.
--
-- AND A BUG I INTRODUCED IN THE FIRST ATTEMPT, worth recording because the shape
-- recurs: the function wrote user_roles FIRST and validated the hospital name
-- afterwards, then returned early on failure. So
--
--     select grant_app_role('<the only admin>', 'facility_staff', 'No Such Hospital');
--
-- DEMOTED the project's only admin to facility_staff and answered with a message
-- about the hospital, saying nothing about the role it had just changed. Caught
-- because the test call was made against a real account.
--
-- Rule: resolve everything that can fail BEFORE the first write. A function that
-- changes one thing and then reports it could not change another is worse than one
-- that refuses outright. Both failure paths now answer "REFUSED, nothing changed".
--
-- Full body: select pg_get_functiondef('public.grant_app_role(text,text,text,text)'::regprocedure);

-- 2 -------------------------------------------------------------------------
-- The audit trail rendered "hospitals asked -> hospitals contacted -> case opened",
-- with the creation of the incident third. `at` defaults to now(), which is
-- TRANSACTION time, so every event written in one transaction carries an identical
-- timestamp and the order is whatever the planner returns. An audit trail that
-- reorders itself is not one.
--
-- clock_timestamp() would break the tie but changes the meaning of `at` and needs
-- every writer edited. A sequence is one column, monotonic by construction.
alter table public.incident_events add column if not exists seq bigserial;

create index if not exists idx_incident_events_seq
  on public.incident_events (incident_id, seq);

comment on column public.incident_events.seq is
  'Insertion order. Order by this, not by `at`: events written in one transaction share a timestamp.';

-- NOTE for anyone reading a trail written before this migration: bigserial numbered
-- the existing rows in physical order, so historic trails may still look shuffled.
-- Rows written after it are correct.

-- 3 -------------------------------------------------------------------------
-- open_dispatch called emit_wave_offers and only THEN wrote its own 'dispatch_opened'
-- event, so even with correct ordering the trail read "hospitals asked" before
-- "hospitals contacted" — the search appearing to start after the offers went out.
-- The event insert now precedes the offers. Full body via pg_get_functiondef.

-- Also verified this morning, not assumed:
--   * a real facility_staff login lands on /facility/inbox, sees ONLY its own
--     hospital's case, and Accept moves the incident to dispatched and opens the
--     vehicle leg by itself
--   * both grant_app_role failure paths leave user_roles untouched
--   * a fresh incident's trail reads incident_created -> dispatch_opened -> wave_offered
