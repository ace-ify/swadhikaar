-- Swadhikaar - API role grants
--
-- 001 creates every table, enables RLS and writes policies, but never GRANTs
-- table privileges to the PostgREST roles. On current Supabase versions the
-- default privileges for schema `public` no longer include DML (pg_default_acl
-- shows anon/authenticated/service_role receiving only Dxtm — TRUNCATE,
-- REFERENCES, TRIGGER, MAINTAIN), so every table came out unreadable and
-- unwritable by the API.
--
-- A policy cannot rescue a missing grant: Postgres checks GRANT first and RLS
-- second. Without this migration both the edge functions and the web client
-- fail with "permission denied for table ...".

-- ============================================
-- Schema access
-- ============================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ============================================
-- service_role — the backend identity used by edge functions.
-- Bypasses RLS, so the grant is the only gate. Needs full DML.
-- ============================================
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ============================================
-- authenticated — signed-in clinicians and admins.
-- Full DML here is deliberate: reachability is decided by the RLS policies in
-- 001, not by the grant. Removing a grant would break the policy model rather
-- than tighten it.
-- ============================================
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ============================================
-- anon — unauthenticated visitors.
-- Deliberately NOT granted across the board. This is patient data; a future
-- permissive policy or an accidental `DISABLE ROW LEVEL SECURITY` should not be
-- one step away from a public leak. Only the reference table that 001 explicitly
-- publishes (policy "drug_mapping_read" USING (true)) is exposed.
-- ============================================
GRANT SELECT ON TABLE drug_brand_mapping TO anon;

-- ============================================
-- Future tables. Without this every later migration reintroduces the same bug.
-- Applies to objects created by the migration role (postgres).
-- ============================================
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO service_role, authenticated;
