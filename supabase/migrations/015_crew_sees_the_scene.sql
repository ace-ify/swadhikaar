-- THE CREW COULD NOT SEE THE PHOTO. Found while wiring the operator app: 013 added a
-- scene photograph and rendered it in the ops console, the facility inbox and the
-- reporter's own status screen -- and not to the ambulance crew driving to that scene,
-- who are the one audience for whom a picture of the roadside changes what they do
-- before they arrive.
--
-- Two causes, and the fix is one clause in each:
--   * storage.scene_photo_read has four `or` branches and none of them is the assigned
--     unit's operator. The crew is not the reporter, not ops, not staff of an offered
--     facility, and -- because the vehicle leg tracks crews in fleet_units rather than
--     incident_responders -- not a responder row either.
--   * my_fleet_run() never selected scene_photo_path, so even with read access the
--     screen had no path to sign. Written on one side, never received on the other.
--
-- Fixed at the policy, not at the caller: everything that signs a URL for that bucket
-- goes through this one policy, so widening it here covers the crew screen and anything
-- later that shows a crew their case.

-- ------------------------------------------------------------- storage read policy
-- Restated whole rather than patched, because a policy is replaced, not appended to.
-- The first four branches are 013's, unchanged.
drop policy if exists scene_photo_read on storage.objects;
create policy scene_photo_read on storage.objects for select to authenticated
using (
  bucket_id = 'incident-scene'
  and exists (
    select 1 from public.incidents i
     where i.id = public.scene_photo_incident(name)
       and (
         i.created_by = auth.uid()
         or public.current_user_has_role(array['admin', 'dispatcher', 'doctor'])
         or exists (select 1 from public.dispatch_offers o
                     where o.incident_id = i.id
                       and o.facility_id = any (public.current_user_facility_ids()))
         or exists (select 1 from public.incident_responders r
                     where r.incident_id = i.id and r.responder_uid = auth.uid())
         -- NEW: the crew currently carrying this run. Scoped to assigned_incident_id,
         -- so it lapses the moment the run ends -- a crew does not keep sight of a
         -- stranger's scene after they have handed over.
         or exists (select 1 from public.fleet_units u
                     where u.assigned_incident_id = i.id
                       and u.operator_uid = auth.uid()))));

-- ------------------------------------------------------------------ my_fleet_run
-- One added column: i.scene_photo_path. Everything else is 011's definition.
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
             i.scene_photo_path,
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

revoke all on function public.my_fleet_run() from public, anon;
grant execute on function public.my_fleet_run() to authenticated;
