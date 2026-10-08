-- 019_pmjay_hospital_coords.sql
-- PS-02 map: coordinates for empanelled hospitals. The official district files carry
-- no lat/lon, so these are geocoded best-effort (scripts/geocode_pmjay.py) from the
-- hospital name + district, falling back to the district centroid. geo_source records
-- which ('hospital' | 'district'), so the UI can mark approximate pins honestly.
-- Applied to the live DB via the Supabase MCP as migration "pmjay_hospital_coords".
alter table public.pmjay_hospitals
  add column if not exists lat double precision,
  add column if not exists lon double precision,
  add column if not exists geo_source text;
