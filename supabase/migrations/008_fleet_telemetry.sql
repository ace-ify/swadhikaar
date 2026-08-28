-- FLEET TELEMETRY — simulated vehicle movement, as applied 2026-08-28.
--
-- Every position this writes is invented, and the console badges it. It exists
-- because the alternative EOS chose is worse: their demo units' motion is computed in
-- the CLIENT from docId.hashCode against the wall clock and never persisted, so two
-- people watching the same ambulance see two different ambulances and nothing
-- downstream can read a position at all.
--
-- This writes fleet_units.lat/lon — the same columns a real operator's device would
-- post to — so the map, the ETA and realtime are all exercised for real. Swap in
-- devices posting genuine heartbeats and nothing else in the system changes.

create or replace function public.bearing_deg(
  p_lat1 numeric, p_lon1 numeric, p_lat2 numeric, p_lon2 numeric)
returns integer language sql immutable set search_path to ''
as $function$
  select ((degrees(atan2(
      sin(radians(p_lon2 - p_lon1)) * cos(radians(p_lat2)),
      cos(radians(p_lat1)) * sin(radians(p_lat2))
        - sin(radians(p_lat1)) * cos(radians(p_lat2)) * cos(radians(p_lon2 - p_lon1))
    ))::numeric + 360)::integer % 360);
$function$;

-- One step toward a target at 30 km/h — the same speed the ETA assumes, so the
-- marker and the countdown cannot contradict each other.
create or replace function public.step_toward(
  p_lat numeric, p_lon numeric, p_to_lat numeric, p_to_lon numeric, p_km numeric)
returns record language plpgsql immutable set search_path to 'public'
as $function$
declare
  d numeric; f numeric; out_rec record;
begin
  d := haversine_km(p_lat, p_lon, p_to_lat, p_to_lon);
  if d is null or d <= p_km then
    select p_to_lat, p_to_lon, true into out_rec;
    return out_rec;
  end if;
  f := p_km / d;
  select round(p_lat + (p_to_lat - p_lat) * f, 6),
         round(p_lon + (p_to_lon - p_lon) * f, 6),
         false
    into out_rec;
  return out_rec;
end;
$function$;

-- A terminal state for the vehicle leg. Its absence is what caused the defect below.
alter type ambulance_dispatch_state add value if not exists 'delivered';

-- THE DEFECT THIS MIGRATION FIXES, found by running a vehicle all the way to the
-- hospital rather than stopping at "it moved":
--
-- The first version freed the crew on arrival but never moved ambulance_state out of
-- 'transporting', and the tick loop joins on incident_dispatch.assigned_unit_id —
-- which it also never cleared. So the row still matched on the next tick, delivered
-- the same patient again, and appended another 'patient_arrived' row. Twelve of them
-- in two minutes, into an APPEND-ONLY audit table, at three ticks a minute forever.
--
-- The table has no update or delete policy by design, so a false repeated event there
-- is not something an operator could ever clean up. Three guards now, deliberately
-- belt-and-braces on a loop that writes to an immutable log:
--   * ambulance_state moves to 'delivered', which the loop does not select
--   * assigned_unit_id is cleared, so the join stops matching
--   * the loop skips any incident already 'arrived'
create or replace function public.tick_fleet_positions(p_seconds integer default 20)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  r record;
  step_km numeric := (30.0 * p_seconds / 3600.0);
  moved integer := 0;
  arrived_scene integer := 0;
  arrived_hospital integer := 0;
  nxt record;
begin
  for r in
    select u.id as unit_id, u.lat, u.lon, u.call_sign,
           d.incident_id, d.ambulance_state,
           i.lat as scene_lat, i.lon as scene_lon,
           f.lat as hosp_lat, f.lon as hosp_lon, f.name as hosp_name
      from fleet_units u
      join incident_dispatch d on d.assigned_unit_id = u.id
      join incidents i on i.id = d.incident_id
      left join facilities f on f.id = d.accepted_facility_id
     where u.is_simulated
       and d.ambulance_state in ('en_route','on_scene','transporting')
       and i.status <> 'arrived'
       and u.lat is not null and u.lon is not null
    for update of u skip locked
  loop
    if r.ambulance_state = 'en_route' then
      select * into nxt from step_toward(r.lat, r.lon, r.scene_lat, r.scene_lon, step_km)
        as t(lat numeric, lon numeric, arrived boolean);
      update fleet_units
         set lat = nxt.lat, lon = nxt.lon,
             heading_deg = bearing_deg(r.lat, r.lon, r.scene_lat, r.scene_lon),
             updated_at = now()
       where id = r.unit_id;
      moved := moved + 1;

      if nxt.arrived then
        update incident_dispatch set ambulance_state = 'on_scene'
         where incident_id = r.incident_id;
        insert into incident_events (incident_id, action, detail)
        values (r.incident_id, 'ambulance_on_scene',
                jsonb_build_object('call_sign', r.call_sign, 'simulated_position', true));
        arrived_scene := arrived_scene + 1;
      end if;

    elsif r.ambulance_state = 'on_scene' then
      -- A crew does not teleport off a scene. 90 seconds of loading: short for
      -- reality, long enough to be visible in a demo.
      if now() > coalesce(
           (select max(e.at) from incident_events e
             where e.incident_id = r.incident_id and e.action = 'ambulance_on_scene'),
           now()) + interval '90 seconds' then
        update incident_dispatch set ambulance_state = 'transporting'
         where incident_id = r.incident_id;
        update incidents set status = 'en_route'
         where id = r.incident_id and status in ('pending','dispatched');
        insert into incident_events (incident_id, action, detail)
        values (r.incident_id, 'ambulance_transporting',
                jsonb_build_object('call_sign', r.call_sign, 'to', r.hosp_name));
      end if;

    elsif r.ambulance_state = 'transporting' and r.hosp_lat is not null then
      select * into nxt from step_toward(r.lat, r.lon, r.hosp_lat, r.hosp_lon, step_km)
        as t(lat numeric, lon numeric, arrived boolean);
      update fleet_units
         set lat = nxt.lat, lon = nxt.lon,
             heading_deg = bearing_deg(r.lat, r.lon, r.hosp_lat, r.hosp_lon),
             updated_at = now()
       where id = r.unit_id;
      moved := moved + 1;

      if nxt.arrived then
        -- Patient delivered. The crew returns to the board; the incident does NOT
        -- close itself, because whether care succeeded is not something a cron knows.
        update incidents set status = 'arrived' where id = r.incident_id;
        update incident_dispatch
           set ambulance_state = 'delivered', assigned_unit_id = null
         where incident_id = r.incident_id;
        update fleet_units
           set available = true, assigned_incident_id = null, updated_at = now()
         where id = r.unit_id;
        insert into incident_events (incident_id, action, detail)
        values (r.incident_id, 'patient_arrived',
                jsonb_build_object('call_sign', r.call_sign, 'facility', r.hosp_name));
        arrived_hospital := arrived_hospital + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('moved', moved, 'reached_scene', arrived_scene,
                            'delivered', arrived_hospital, 'at', now());
end;
$function$;

revoke all on function public.tick_fleet_positions(integer) from public, anon, authenticated;
revoke all on function public.bearing_deg(numeric,numeric,numeric,numeric) from public, anon;
revoke all on function public.step_toward(numeric,numeric,numeric,numeric,numeric) from public, anon;
grant execute on function public.bearing_deg(numeric,numeric,numeric,numeric) to authenticated;

-- Positions have to reach the browser, so the units table joins the publication.
alter table public.fleet_units replica identity full;
alter publication supabase_realtime add table public.fleet_units;

-- Every 20 seconds. pg_cron's floor is one minute, so three staggered jobs — the
-- same trick the dispatch sweep uses.
--   select cron.schedule('fleet-tick-00', '* * * * *',
--     $$select public.tick_fleet_positions(20)$$);
--   select cron.schedule('fleet-tick-20', '* * * * *',
--     $$select pg_sleep(20); select public.tick_fleet_positions(20)$$);
--   select cron.schedule('fleet-tick-40', '* * * * *',
--     $$select pg_sleep(40); select public.tick_fleet_positions(20)$$);

-- Wired into the map on the same day. The OperationsMap component already took a
-- `units` prop and /admin/map never passed one, so the ambulance layer rendered an
-- always-empty array -- the written-but-never-read shape this project keeps meeting,
-- for the fourth time. The page now owns the realtime subscription (useAcutePulse +
-- useFleetUnits) and the component stays a renderer.

-- Vehicles parked wherever they last delivered during testing. Returned to their own
-- stations with a deterministic md5-derived offset, so the map opens tidy and the
-- offset is reproducible rather than random:
--
--   update fleet_units u
--      set lat = f.lat + ((('x'||substr(md5(u.call_sign),1,4))::bit(16)::int % 17 - 8) * 0.0035),
--          lon = f.lon + ((('x'||substr(md5(u.call_sign),5,4))::bit(16)::int % 19 - 9) * 0.0035),
--          heading_deg = (('x'||substr(md5(u.call_sign),9,4))::bit(16)::int % 360)
--     from facilities f where f.id = u.stationed_facility_id;
