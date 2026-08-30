-- FLEET OPERATOR APP — applied 2026-08-29 in two parts via the Supabase MCP.
-- Part A had to be separate: ALTER TYPE ADD VALUE cannot be used in the same
-- transaction that adds it.
--
-- WHAT WAS ALREADY THERE. Almost all of it. 005_fleet_and_intake.sql built the whole
-- vehicle leg — units, offers, accept/reject, the 180s deadline, the sweeper — and
-- 008_fleet_telemetry.sql drove it with a cron. The only thing missing was a screen
-- for the human in the vehicle, and the phase transitions that a cron was doing on
-- their behalf. So this migration is small on purpose.
--
-- AUTHORISATION IS NOT THE NEW ROLE. A crew's identity is fleet_units.operator_uid,
-- which 005 already used in fleet_units_read, fleet_units_self_update,
-- fleet_assignments_read and can_answer_for_unit. 'fleet_operator' exists only so
-- login knows which app to open. Deleting the role would cost navigation, not
-- security.
--
-- GPS IS NOT AN RPC. fleet_units_self_update already lets an operator UPDATE their
-- own row, and tick_fleet_positions filters `where u.is_simulated`, so a real crew's
-- phone and the demo cron write disjoint sets of rows and never fight. A real unit is
-- is_simulated = false and moves only when a phone says so.

-- ============================================================ part A (own txn)
alter table public.user_roles drop constraint if exists user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('admin','doctor','asha','patient','farmer',
                  'facility_staff','dispatcher','fleet_operator'));

alter type ambulance_dispatch_state add value if not exists 'returning';

-- ============================================================ part B
-- Three functions. No new RLS policies: a fleet operator has no read on incidents or
-- incident_dispatch (checked against pg_policies — incidents_read_* covers ops,
-- offered facilities, the reporter and incident_responders, and a vehicle operator is
-- none of those). One security-definer read returning exactly the crew's fields is a
-- smaller surface than widening four policies.
--
-- The three bodies below are the deployed definitions, dumped with
-- pg_get_functiondef immediately after applying, so this file cannot drift from the
-- project the way risk-predict did. See README.md in this directory.

create or replace function public.my_fleet_run()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  u record; o record; ofr jsonb := null; run jsonb := null;
begin
  select id, call_sign, driver_name, vehicle_type, phone, lat, lon, heading_deg,
         available, is_simulated, assigned_incident_id, stationed_facility_id, updated_at
    into u
    from fleet_units
   where operator_uid = auth.uid()
   order by updated_at desc
   limit 1;
  if not found then
    return jsonb_build_object('unit', null, 'offer', null, 'run', null);
  end if;

  -- The open offer, if the crew is being asked. Mirrors accept_fleet_offer's own
  -- window: awaiting_response AND not past its absolute deadline, so the screen
  -- cannot show an Accept button the RPC would refuse.
  select fa.id as assignment_id, fa.incident_id, fa.distance_km,
         fa.response_deadline_at, fa.attempt,
         i.ref, i.incident_type, i.severity, i.triage_colour,
         i.address, i.district, i.lat, i.lon,
         f.name as dispatching_facility
    into o
    from fleet_assignments fa
    join incidents i on i.id = fa.incident_id
    left join facilities f on f.id = fa.dispatching_facility_id
   where fa.unit_id = u.id
     and fa.state = 'awaiting_response'
     and fa.response_deadline_at > now()
   order by fa.dispatched_at desc
   limit 1;
  if found then ofr := to_jsonb(o); end if;

  if u.assigned_incident_id is not null then
    select to_jsonb(x) into run from (
      select i.id as incident_id, i.ref, i.victim_name, i.victim_age,
             i.incident_type, i.severity, i.triage_colour, i.description,
             i.address, i.district, i.lat, i.lon, i.status,
             i.vitals, i.medical_snapshot, i.required_services,
             i.reporter_name, i.reporter_phone, i.golden_hour_start,
             d.ambulance_state as phase, d.ambulance_eta_seconds as eta_seconds,
             d.ambulance_accepted_at,
             f.name as destination_name, f.lat as destination_lat, f.lon as destination_lon
        from incidents i
        left join incident_dispatch d on d.incident_id = i.id
        left join facilities f on f.id = d.accepted_facility_id
       where i.id = u.assigned_incident_id
    ) x;
  end if;

  return jsonb_build_object('unit', to_jsonb(u), 'offer', ofr, 'run', run);
end;
$function$;

-- Strictly linear, and every step is asserted against the current state rather than
-- trusted from the client: en_route -> on_scene -> transporting -> delivered ->
-- returning -> (complete frees the unit).
--
-- KNOWN GAP, on purpose: there is no stand-down path (crew arrives, no patient to
-- carry). Reversing out of a run is a cancellation, and cancel_my_incident plus the
-- ops console already own that. A second way to end a run would mean a coarse
-- ambulance_state that claims 'delivered' when nobody was.
create or replace function public.set_ambulance_phase(p_incident uuid, p_phase text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  d record; u record; required ambulance_dispatch_state[];
begin
  select assigned_unit_id, accepted_facility_id, ambulance_state
    into d from incident_dispatch where incident_id = p_incident;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_dispatch'); end if;
  if d.assigned_unit_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_unit_assigned');
  end if;
  if not can_answer_for_unit(d.assigned_unit_id, d.accepted_facility_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorised_for_unit');
  end if;

  required := case p_phase
    when 'on_scene'     then array['en_route']::ambulance_dispatch_state[]
    when 'transporting' then array['on_scene']::ambulance_dispatch_state[]
    when 'delivered'    then array['transporting']::ambulance_dispatch_state[]
    when 'returning'    then array['delivered']::ambulance_dispatch_state[]
    when 'complete'     then array['returning']::ambulance_dispatch_state[]
    else null end;
  if required is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_phase', 'phase', p_phase);
  end if;
  if not (d.ambulance_state = any (required)) then
    return jsonb_build_object('ok', false, 'error', 'out_of_order',
                              'current', d.ambulance_state, 'wanted', p_phase);
  end if;

  select call_sign into u from fleet_units where id = d.assigned_unit_id;

  if p_phase = 'complete' then
    -- The vehicle leg ends. ambulance_state stays 'delivered' -- the terminal value
    -- the rest of the system already reads -- and the crew's return is in the log.
    update incident_dispatch
       set ambulance_state = 'delivered', assigned_unit_id = null
     where incident_id = p_incident;
    update fleet_units
       set available = true, assigned_incident_id = null, updated_at = now()
     where id = d.assigned_unit_id;
  else
    update incident_dispatch set ambulance_state = p_phase::ambulance_dispatch_state
     where incident_id = p_incident;
  end if;

  if p_phase = 'transporting' then
    update incidents set status = 'en_route'
     where id = p_incident and status in ('pending','dispatched');
  elsif p_phase = 'delivered' then
    -- Same as the simulated path: the patient is at the hospital, but whether care
    -- succeeded is not something a vehicle knows, so the incident does not close.
    update incidents set status = 'arrived' where id = p_incident;
  end if;

  insert into incident_events (incident_id, actor_uid, actor_role, action, detail)
  values (p_incident, auth.uid(), 'fleet',
          case p_phase
            when 'on_scene'     then 'ambulance_on_scene'
            when 'transporting' then 'ambulance_transporting'
            when 'delivered'    then 'patient_arrived'
            when 'returning'    then 'ambulance_returning'
            else 'ambulance_run_complete' end,
          jsonb_build_object('call_sign', u.call_sign, 'phase', p_phase,
                             'reported_by_crew', true));

  return jsonb_build_object('ok', true, 'phase', p_phase);
end;
$function$;

-- Appended to incident_events, not stored as a mutable blob: a care record is a
-- timeline, the dispatch console and facility inbox already render that timeline, and
-- the table is append-only by design. medical_snapshot is deliberately NOT touched --
-- 010's trigger owns it from emergency_snapshot(), and MedicalSnapshot renders it.
-- The numeric vitals ARE merged into incidents.vitals, because a receiving ED wants
-- the latest reading on the snapshot, not a chronology it has to read backwards.
create or replace function public.fleet_record_care(p_incident uuid, p_entry jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare d record; u record;
begin
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'entry_must_be_object');
  end if;

  select assigned_unit_id, accepted_facility_id
    into d from incident_dispatch where incident_id = p_incident;
  if not found or d.assigned_unit_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_unit_assigned');
  end if;
  if not can_answer_for_unit(d.assigned_unit_id, d.accepted_facility_id) then
    return jsonb_build_object('ok', false, 'error', 'not_authorised_for_unit');
  end if;

  select call_sign into u from fleet_units where id = d.assigned_unit_id;

  insert into incident_events (incident_id, actor_uid, actor_role, action, detail)
  values (p_incident, auth.uid(), 'fleet', 'en_route_care',
          p_entry || jsonb_build_object('call_sign', u.call_sign));

  if jsonb_typeof(p_entry -> 'vitals') = 'object' then
    update incidents set vitals = coalesce(vitals, '{}'::jsonb) || (p_entry -> 'vitals')
     where id = p_incident;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.my_fleet_run() from public, anon;
revoke all on function public.set_ambulance_phase(uuid, text) from public, anon;
revoke all on function public.fleet_record_care(uuid, jsonb) from public, anon;
grant execute on function public.my_fleet_run() to authenticated;
grant execute on function public.set_ambulance_phase(uuid, text) to authenticated;
grant execute on function public.fleet_record_care(uuid, jsonb) to authenticated;

-- Driver SOS needs NO backend at all: incident-intake already accepts
-- channel='sos_button' with a signed-in bearer token, and reported_for_self=false is
-- exactly the "this is not about me" case it was built for. The crew's button posts
-- the same body the patient's button posts.
