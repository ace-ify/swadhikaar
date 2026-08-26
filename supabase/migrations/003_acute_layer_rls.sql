-- ACUTE LAYER — RLS, as applied 2026-08-26. Schema is in 002_acute_layer_schema.sql.
--
-- EOS's own firestore.rules concedes the problem it does not solve: sos_incidents,
-- the assignments, ops_hospitals, hospital_reliability, audit_log and victim_activity
-- are readable by ANY authenticated user — full medical snapshot included — deferred
-- to a "server-computed public views" roadmap that does not exist. And
-- ops_fleet_units is `allow write: if request.auth != null`, so any signed-in account
-- can rewrite any ambulance's status.
--
-- Postgres can express the real rule, so it does.

create or replace function public.current_user_facility_ids()
returns uuid[]
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(array_agg(facility_id), '{}')
    from facility_staff where user_id = auth.uid();
$function$;

create or replace function public.current_user_has_role(p_roles text[])
returns boolean
language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from user_roles where user_id = auth.uid() and role = any (p_roles));
$function$;

revoke all on function public.current_user_facility_ids() from public, anon;
revoke all on function public.current_user_has_role(text[]) from public, anon;
grant execute on function public.current_user_facility_ids() to authenticated;
grant execute on function public.current_user_has_role(text[]) to authenticated;

alter table public.incidents            enable row level security;
alter table public.incident_dispatch    enable row level security;
alter table public.dispatch_offers      enable row level security;
alter table public.incident_events      enable row level security;
alter table public.incident_responders  enable row level security;
alter table public.facility_reliability enable row level security;
alter table public.facility_staff       enable row level security;

-- ------------------------------------------------------------------ incidents
drop policy if exists incidents_read_ops on public.incidents;
create policy incidents_read_ops on public.incidents for select to authenticated
  using (current_user_has_role(array['admin','dispatcher','doctor']));

-- A facility sees only incidents it was offered — not the whole district's medical
-- snapshots.
drop policy if exists incidents_read_offered_facility on public.incidents;
create policy incidents_read_offered_facility on public.incidents for select to authenticated
  using (exists (
    select 1 from dispatch_offers o
     where o.incident_id = incidents.id
       and o.facility_id = any (current_user_facility_ids())));

-- A responder sees what they are attending. ASHAs additionally see open incidents,
-- because the point of a community responder is proximity.
drop policy if exists incidents_read_responder on public.incidents;
create policy incidents_read_responder on public.incidents for select to authenticated
  using (
    exists (select 1 from incident_responders r
             where r.incident_id = incidents.id and r.responder_uid = auth.uid())
    or (current_user_has_role(array['asha']) and incidents.status in ('pending','dispatched')));

drop policy if exists incidents_write_ops on public.incidents;
create policy incidents_write_ops on public.incidents for all to authenticated
  using (current_user_has_role(array['admin','dispatcher']))
  with check (current_user_has_role(array['admin','dispatcher']));

-- ---------------------------------------------------------- incident_dispatch
-- Read-only to everyone who can see the incident; ONLY the engine writes it, so there
-- is no client write policy at all. A facility cannot mark itself accepted by UPDATE —
-- it must go through accept_dispatch_offer(), which is what makes "only the current
-- wave may accept" enforceable rather than advisory.
drop policy if exists dispatch_read on public.incident_dispatch;
create policy dispatch_read on public.incident_dispatch for select to authenticated
  using (
    current_user_has_role(array['admin','dispatcher','doctor'])
    or exists (select 1 from dispatch_offers o
                where o.incident_id = incident_dispatch.incident_id
                  and o.facility_id = any (current_user_facility_ids())));

-- ------------------------------------------------------------ dispatch_offers
-- A facility sees ONLY its own offers. This is the inbox. No write policy: offers are
-- engine-written, accept and decline are security-definer functions.
drop policy if exists offers_read_own_facility on public.dispatch_offers;
create policy offers_read_own_facility on public.dispatch_offers for select to authenticated
  using (
    facility_id = any (current_user_facility_ids())
    or current_user_has_role(array['admin','dispatcher']));

-- ------------------------------------------------------------ incident_events
drop policy if exists events_read on public.incident_events;
create policy events_read on public.incident_events for select to authenticated
  using (
    current_user_has_role(array['admin','dispatcher','doctor'])
    or exists (select 1 from dispatch_offers o
                where o.incident_id = incident_events.incident_id
                  and o.facility_id = any (current_user_facility_ids())));

drop policy if exists events_insert on public.incident_events;
create policy events_insert on public.incident_events for insert to authenticated
  with check (actor_uid = auth.uid() or actor_uid is null);
-- Deliberately NO update or delete policy anywhere on this table: an audit trail that
-- can be edited is not one.

-- -------------------------------------------------------- incident_responders
drop policy if exists responders_read on public.incident_responders;
create policy responders_read on public.incident_responders for select to authenticated
  using (
    current_user_has_role(array['admin','dispatcher','doctor'])
    or responder_uid = auth.uid()
    or exists (select 1 from dispatch_offers o
                where o.incident_id = incident_responders.incident_id
                  and o.facility_id = any (current_user_facility_ids())));

drop policy if exists responders_self_accept on public.incident_responders;
create policy responders_self_accept on public.incident_responders for insert to authenticated
  with check (responder_uid = auth.uid());

-- A responder updates only their own row. EOS lets any signed-in account write any
-- fleet unit document; this cannot.
drop policy if exists responders_self_update on public.incident_responders;
create policy responders_self_update on public.incident_responders for update to authenticated
  using (responder_uid = auth.uid() or current_user_has_role(array['admin','dispatcher']))
  with check (responder_uid = auth.uid() or current_user_has_role(array['admin','dispatcher']));

-- ------------------------------------------------------- facility_reliability
drop policy if exists reliability_read on public.facility_reliability;
create policy reliability_read on public.facility_reliability for select to authenticated
  using (
    current_user_has_role(array['admin','dispatcher'])
    or facility_id = any (current_user_facility_ids()));

-- ------------------------------------------------------------- facility_staff
drop policy if exists facility_staff_read on public.facility_staff;
create policy facility_staff_read on public.facility_staff for select to authenticated
  using (user_id = auth.uid() or current_user_has_role(array['admin']));

drop policy if exists facility_staff_admin on public.facility_staff;
create policy facility_staff_admin on public.facility_staff for all to authenticated
  using (current_user_has_role(array['admin']))
  with check (current_user_has_role(array['admin']));

-- --------------------------------------------------------------- cron schedule
-- pg_cron granularity is one minute, and the critical fuse is 45 seconds, so four
-- staggered jobs give 15s resolution. EOS runs theirs every 60s against the same 45s
-- fuse, which is why their measured escalation latency is 45-105s.
--
--   select cron.schedule('dispatch-sweep-00', '* * * * *',
--     $$select public.sweep_dispatch_timeouts()$$);
--   select cron.schedule('dispatch-sweep-15', '* * * * *',
--     $$select pg_sleep(15); select public.sweep_dispatch_timeouts()$$);
--   select cron.schedule('dispatch-sweep-30', '* * * * *',
--     $$select pg_sleep(30); select public.sweep_dispatch_timeouts()$$);
--   select cron.schedule('dispatch-sweep-45', '* * * * *',
--     $$select pg_sleep(45); select public.sweep_dispatch_timeouts()$$);
--   select cron.schedule('expire-stale-incidents', '11,41 * * * *',
--     $$select public.expire_stale_incidents(180)$$);
