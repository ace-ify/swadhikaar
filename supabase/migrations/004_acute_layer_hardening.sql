-- ACUTE LAYER — hardening, as applied 2026-08-27. Schema in 002, RLS in 003.
--
-- Four fixes found while building the dispatch console on top of the engine. Every
-- one of them was invisible from the database side and only showed up when a real
-- caller (a browser, with a real logged-in user) went through the front door.

-- 1 -------------------------------------------------------------------------
-- accept_dispatch_offer / decline_dispatch_offer were SECURITY DEFINER and never
-- checked that the CALLER had anything to do with p_facility. Any authenticated
-- account could accept a case on behalf of any hospital in the state. The wave
-- check was enforced; the identity check did not exist. This is the same defect
-- this port criticises EOS for (ops_fleet_units: `allow write: if request.auth
-- != null`), reproduced by accident in our own engine.
--
-- Guard added at the top of both, before any row is read:
--
--   if not (current_user_has_role(array['admin','dispatcher'])
--           or exists (select 1 from facility_staff s
--                       where s.user_id = auth.uid()
--                         and s.facility_id = p_facility
--                         and s.can_accept))          -- can_accept: accept only
--   then return jsonb_build_object('ok', false, 'error',
--                                  'not_authorised_for_facility'); end if;
--
-- Verified three ways: an asha with no staff row is refused; a staff row for a
-- facility in an earlier wave gets not_in_current_wave; a staff row in the current
-- wave accepts. Full bodies: select pg_get_functiondef(...).

-- 2 -------------------------------------------------------------------------
-- escalate_dispatch and open_dispatch were callable over /rest/v1/rpc by any
-- authenticated account -- force any incident to its next wave, or spend fifteen
-- facilities' attention on any incident.
--
-- escalate_dispatch is REVOKED rather than guarded, because guarding it on the
-- caller's role would break the legitimate path: decline_dispatch_offer calls it
-- when the last member of a wave declines, and there the caller is facility staff.
-- Inside a SECURITY DEFINER function privilege checks run as the definer, so the
-- internal call needs no grant at all.
revoke execute on function public.escalate_dispatch(uuid,text) from authenticated;

-- open_dispatch keeps its grant (the console needs it) and gained:
--   if auth.uid() is not null
--      and not current_user_has_role(array['admin','dispatcher'])
--   then return jsonb_build_object('ok', false, 'error', 'not_authorised'); end if;
-- auth.uid() is null under the service-role key, which is how an intake edge
-- function or cron opens dispatch server-side.

-- 3 -------------------------------------------------------------------------
-- A non-numeric vital aborted the INSERT. classify_incident_severity used
-- `nullif(x,'')::numeric`, which handles missing and empty and throws 22P02 on
-- anything else -- and it runs inside the severity trigger, so `"spo2":"low"` from
-- an SMS or a voice transcription did not degrade to "unmeasured", it lost the
-- entire incident.
create or replace function public.numeric_or_null(p text)
returns numeric
language sql
immutable
set search_path to ''
as $function$
  select case when p ~ '^\s*-?\d+(\.\d+)?\s*$' then trim(p)::numeric end;
$function$;

comment on function public.numeric_or_null(text) is
  'Parses a numeric or returns null. Never throws, so a malformed vital reads as unmeasured instead of aborting the transaction.';

revoke all on function public.numeric_or_null(text) from public, anon;

-- 4 -------------------------------------------------------------------------
-- The classifier read ONLY health_vitals' column spellings (oxygen_saturation,
-- systolic_bp, heart_rate, respiratory_rate) while every acute caller sends the
-- clinical shorthand (spo2, sbp, hr, rr). A key that does not match reads as
-- absent, and absent vitals escalate nothing -- so a GCS 7 / SpO2 88 road accident
-- was reaching 'critical' on its triage colour and the word "accident", with the
-- physiology contributing NOTHING. Written on one side, never read on the other:
-- invisible because the visible half worked.
--
-- Fixed in the reader, not in each caller -- one coalesce covers every intake path
-- that will ever write an incident:
--
--   spo2 := numeric_or_null(coalesce(p_vitals->>'oxygen_saturation',
--                                    p_vitals->>'spo2'));
--   ... same for sbp/dbp/hr/rr, and gcs/glasgow_coma_scale
--
-- Verified: {"spo2":88} and {"oxygen_saturation":88} both critical; {"gcs":7}
-- critical; {"hr":118} high; {} standard; {"spo2":"low"} standard, no throw;
-- {"spo2":" 88 "} critical.

-- 5 -------------------------------------------------------------------------
-- The console polled because nothing but `escalations` was published. replica
-- identity full so an UPDATE payload carries the old row: a subscriber needs to
-- know an offer went pending -> superseded, and the default (primary key only)
-- does not say what it was before.
alter table public.incidents          replica identity full;
alter table public.incident_dispatch  replica identity full;
alter table public.dispatch_offers    replica identity full;
alter table public.incident_events    replica identity full;

alter publication supabase_realtime add table public.incidents;
alter publication supabase_realtime add table public.incident_dispatch;
alter publication supabase_realtime add table public.dispatch_offers;
alter publication supabase_realtime add table public.incident_events;

-- 6 -------------------------------------------------------------------------
-- 003 claims these two helpers are revoked from anon. They were not: their ACL
-- still carried a bare `=X` entry, which is PUBLIC, so anon could call them over
-- /rest/v1/rpc. Low impact alone -- they answer for auth.uid(), null for anon -- but
-- they are the helpers every acute RLS policy consults, and a repo file asserting a
-- grant production does not have is worse than no assertion, because it stops
-- anyone re-checking. Verify with `select proacl from pg_proc where ...`, not by
-- reading the migration.
revoke execute on function public.current_user_facility_ids() from public, anon;
revoke execute on function public.current_user_has_role(text[]) from public, anon;
