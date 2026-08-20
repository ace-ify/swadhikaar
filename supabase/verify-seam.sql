-- Schema contract for the acute → continuity seam.
--
--   docker exec -i supabase_db_swadhikaar psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/verify-seam.sql
--
-- The two bugs this catches were both invisible to unit tests, because both
-- lived in the index definitions rather than in the code:
--   1. a PARTIAL unique index cannot arbitrate ON CONFLICT, so the phone
--      fallback — the path most emergency victims take — failed outright;
--   2. fhir_resources had no uniqueness at all, so a re-delivered incident
--      wrote a second Encounter for the same episode of care.
-- Anything that reintroduces either one fails here.

BEGIN;

DO $$
BEGIN
  -- ---- arbiter 1: ABHA ID -------------------------------------------------
  BEGIN
    INSERT INTO patients (abha_id, name, language)
    VALUES ('__verify__abha', 'Verify A', 'hindi')
    ON CONFLICT (abha_id) DO UPDATE SET name = EXCLUDED.name;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'ON CONFLICT (abha_id) is not arbitrable: %', SQLERRM;
  END;

  -- ---- arbiter 2: phone fallback ------------------------------------------
  BEGIN
    INSERT INTO patients (name, phone, language)
    VALUES ('Verify B', '__verify__phone', 'hindi')
    ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'ON CONFLICT (phone) is not arbitrable (partial index?): %', SQLERRM;
  END;

  -- replaying the phone path must update, never duplicate
  INSERT INTO patients (name, phone, language)
  VALUES ('Verify B2', '__verify__phone', 'hindi')
  ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name;

  IF (SELECT count(*) FROM patients WHERE phone = '__verify__phone') <> 1 THEN
    RAISE EXCEPTION 'phone replay duplicated the patient row';
  END IF;

  -- ---- patients without a phone must still be allowed, in any number ------
  INSERT INTO patients (name, language)
  VALUES ('Verify NoPhone 1', 'hindi'), ('Verify NoPhone 2', 'hindi');

  -- ---- arbiter 3: one incident yields one Encounter -----------------------
  BEGIN
    INSERT INTO fhir_resources (patient_id, resource_type, external_ref, fhir_json)
    SELECT id, 'Encounter', '__verify__incident', '{}'::jsonb
    FROM patients WHERE abha_id = '__verify__abha'
    ON CONFLICT (patient_id, resource_type, external_ref) DO NOTHING;

    INSERT INTO fhir_resources (patient_id, resource_type, external_ref, fhir_json)
    SELECT id, 'Encounter', '__verify__incident', '{}'::jsonb
    FROM patients WHERE abha_id = '__verify__abha'
    ON CONFLICT (patient_id, resource_type, external_ref) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'fhir_resources external_ref is not arbitrable: %', SQLERRM;
  END;

  IF (SELECT count(*) FROM fhir_resources WHERE external_ref = '__verify__incident') <> 1 THEN
    RAISE EXCEPTION 'replayed incident wrote a duplicate Encounter';
  END IF;

  -- ---- arbiter 4: the recovery call slot ----------------------------------
  BEGIN
    INSERT INTO voice_calls (patient_id, workflow_id, call_type, status, scheduled_for)
    SELECT p.id, w.id, 'recovery', 'scheduled', TIMESTAMPTZ '2099-01-01 04:30:00+00'
    FROM patients p, workflows w
    WHERE p.abha_id = '__verify__abha' AND w.name = 'Post-Discharge Recovery'
    ON CONFLICT (patient_id, workflow_id, scheduled_for) DO NOTHING;

    INSERT INTO voice_calls (patient_id, workflow_id, call_type, status, scheduled_for)
    SELECT p.id, w.id, 'recovery', 'scheduled', TIMESTAMPTZ '2099-01-01 04:30:00+00'
    FROM patients p, workflows w
    WHERE p.abha_id = '__verify__abha' AND w.name = 'Post-Discharge Recovery'
    ON CONFLICT (patient_id, workflow_id, scheduled_for) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'voice_calls protocol slot is not arbitrable: %', SQLERRM;
  END;

  IF (SELECT count(*) FROM voice_calls
      WHERE scheduled_for = TIMESTAMPTZ '2099-01-01 04:30:00+00') <> 1 THEN
    RAISE EXCEPTION 'replayed enrolment duplicated a recovery call';
  END IF;

  -- ---- the API roles can actually reach the tables ------------------------
  IF NOT has_table_privilege('service_role', 'patients', 'INSERT') THEN
    RAISE EXCEPTION 'service_role cannot INSERT into patients — grants missing';
  END IF;
  IF NOT has_table_privilege('authenticated', 'patients', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated cannot SELECT patients — grants missing';
  END IF;
  IF has_table_privilege('anon', 'patients', 'SELECT') THEN
    RAISE EXCEPTION 'anon can SELECT patients — that grant should not exist';
  END IF;

  RAISE NOTICE 'seam schema contract: all checks passed';
END $$;

ROLLBACK;
