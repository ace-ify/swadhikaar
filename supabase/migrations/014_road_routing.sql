-- 014: the ambulance drives on roads.
--
-- Until now the vehicle moved in a straight line at a flat 30 km/h, and both maps said so
-- in a caption -- honest, but it looks like a dot drifting across a river. The route is
-- the one part of this system a person can check against their own knowledge of the city,
-- so it is the part worth making real.
--
-- OpenRouteService gives road geometry, real distance and a real duration. The key has
-- been sitting in supabase/.env unused since it was added.
--
-- Fallback is deliberate and stays: no key, no quota, no network, or a scene ORS cannot
-- route to (a field, a highway median) all fall back to the straight line rather than
-- freezing the vehicle. A demo that degrades is better than a demo that stops.

-- ---------------------------------------------------------------------------
-- Cache
-- ---------------------------------------------------------------------------
-- ORS free tier is 2000 requests/day and 40/minute. Ambulance-to-scene legs repeat
-- constantly in a demo (same units, same hospitals), so a cache turns a rate limit into a
-- non-issue. Rounded to ~11 m, which is finer than the vehicle steps anyway.
create table if not exists public.route_legs (
  id uuid primary key default gen_random_uuid(),
  from_lat numeric(9,4) not null,
  from_lon numeric(9,4) not null,
  to_lat numeric(9,4) not null,
  to_lon numeric(9,4) not null,
  -- [[lat, lon], ...] -- normalised on write. ORS emits [lon, lat]; storing its order
  -- would leave every reader one transposition away from a vehicle in the Bay of Bengal.
  geometry jsonb not null,
  distance_m numeric not null,
  duration_s numeric not null,
  source text not null default 'openrouteservice',
  created_at timestamptz not null default now(),
  unique (from_lat, from_lon, to_lat, to_lon)
);

alter table public.route_legs enable row level security;

-- Readable by any signed-in user: it is public road geometry, and the patient's map draws
-- it. Writes are service-role only, which is the edge function.
drop policy if exists route_legs_read on public.route_legs;
create policy route_legs_read on public.route_legs for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Where the vehicle is along the route
-- ---------------------------------------------------------------------------
alter table public.incident_dispatch
  add column if not exists route_geometry jsonb,
  add column if not exists route_target text,
  add column if not exists route_index integer not null default 0,
  add column if not exists route_distance_m numeric,
  add column if not exists route_duration_s numeric;

comment on column public.incident_dispatch.route_target is
  'Which leg route_geometry describes: scene (before pickup) or hospital (after). Set by '
  'the route-leg function; cleared when the phase changes so the next leg is fetched.';

-- ---------------------------------------------------------------------------
-- Walking the polyline
-- ---------------------------------------------------------------------------
-- Bodies for advance_along_route, the rewritten tick_fleet_positions and
-- request_route_legs were applied via the MCP; recover them with pg_get_functiondef.
-- The shape:
--
--   advance_along_route(geometry, index, lat, lon, km)
--     Spends a step budget along the polyline, consuming whole segments until it runs
--     out, then step_toward for the remainder. Arrival is running out of polyline, not a
--     distance threshold -- the last vertex IS the destination.
--
--   tick_fleet_positions(seconds)
--     Unchanged state machine. Geometry is used only when route_target matches the leg
--     being driven, so a leftover scene route can never drive a loaded patient back to
--     the pickup point. Both arrival branches clear the route so the next leg fetches
--     its own.
--
--   request_route_legs()
--     Counts legs missing geometry, returns early when there are none, otherwise fires
--     net.http_post at route-leg. Same vault-secret shape place_due_recovery_calls uses.
--
-- Cron, three times a minute, staggered 18s ahead of each fleet tick so a leg that opens
-- mid-window is routed before the straight line becomes visible:
--   route-legs-00 / route-legs-20 / route-legs-40
