-- Swadhikaar - Acute → Continuity seam
-- Lets a completed acute emergency incident create a longitudinal patient record
-- and auto-enrol that patient in the Post-Discharge Recovery protocol.
--
-- Everything here is additive or loosening. No existing column changes type,
-- no existing row is rewritten.

-- ============================================
-- voice_calls: a "scheduled" call had no date to be scheduled *for*
-- ============================================
ALTER TABLE voice_calls
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS workflow_id UUID REFERENCES workflows(id) ON DELETE SET NULL;

-- Idempotency for protocol enrolment: re-delivering the same incident cannot
-- duplicate the Day 1/3/7/14/30 call set.
-- NULL workflow_id rows (ad-hoc calls) never conflict — Postgres treats NULLs as distinct.
CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_calls_protocol_slot
  ON voice_calls (patient_id, workflow_id, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_voice_calls_due
  ON voice_calls (scheduled_for)
  WHERE status = 'scheduled';

-- ============================================
-- fhir_resources: one emergency must produce one Encounter, however many times
-- the acute layer re-delivers it. Without this a replayed incident writes a
-- second Encounter and Condition for the same episode of care.
-- NULL external_ref rows (everything not sourced from an external incident)
-- never conflict, so existing write paths are untouched.
-- ============================================
ALTER TABLE fhir_resources
  ADD COLUMN IF NOT EXISTS external_ref TEXT;

COMMENT ON COLUMN fhir_resources.external_ref IS
  'Originating external identifier, e.g. the acute incident id. Scopes idempotency.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_fhir_external_ref
  ON fhir_resources (patient_id, resource_type, external_ref);

-- ============================================
-- patients: a patient who arrives via an ambulance was never at a health camp
-- ============================================
ALTER TABLE patients
  ALTER COLUMN health_camp DROP NOT NULL,
  ALTER COLUMN camp_type  DROP NOT NULL;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS intake_source TEXT DEFAULT 'health_camp',
  ADD COLUMN IF NOT EXISTS source_incident_id TEXT;

COMMENT ON COLUMN patients.intake_source IS
  'health_camp | acute_incident — how this patient entered the platform';

CREATE INDEX IF NOT EXISTS idx_patients_source_incident
  ON patients (source_incident_id)
  WHERE source_incident_id IS NOT NULL;

-- ============================================
-- Phone is the fallback identity when no ABHA ID is presented, so it has to be
-- usable as an ON CONFLICT arbiter.
--
-- Deliberately NOT partial. A partial index (WHERE phone IS NOT NULL) cannot
-- arbitrate `ON CONFLICT (phone)` — Postgres rejects it with "no unique or
-- exclusion constraint matching the ON CONFLICT specification" unless the
-- statement repeats the predicate, which supabase-js does not emit.
-- The predicate was never needed anyway: Postgres treats NULLs as distinct in a
-- unique index, so any number of patients may still have no phone number.
-- ============================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_patients_phone
  ON patients (phone);
