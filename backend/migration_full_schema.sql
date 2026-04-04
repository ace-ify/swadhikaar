-- =============================================================================
-- Swadhikaar — Full Schema Migration
-- Run this on a fresh Supabase project to recreate the entire database.
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- 1. patients
-- =============================================================================
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    abha_id TEXT UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    language TEXT DEFAULT 'hindi',
    health_camp TEXT NOT NULL,
    camp_type TEXT NOT NULL,
    risk_level TEXT,
    overall_risk_score NUMERIC,
    consent_status TEXT DEFAULT 'pending',
    assigned_doctor_id UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 2. health_vitals
-- =============================================================================
CREATE TABLE IF NOT EXISTS health_vitals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id),
    systolic_bp INTEGER,
    diastolic_bp INTEGER,
    heart_rate INTEGER,
    respiratory_rate INTEGER,
    oxygen_saturation INTEGER,
    temperature NUMERIC,
    blood_glucose INTEGER,
    height NUMERIC,
    weight NUMERIC,
    bmi NUMERIC,
    bmi_category TEXT,
    waist_circumference NUMERIC,
    waist_to_height_ratio NUMERIC,
    perfusion_index NUMERIC,
    recorded_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 3. risk_assessments
-- =============================================================================
CREATE TABLE IF NOT EXISTS risk_assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id),
    heart_risk_score NUMERIC,
    heart_risk_level TEXT,
    diabetic_risk_score NUMERIC,
    diabetic_risk_level TEXT,
    hypertension_risk_score NUMERIC,
    hypertension_risk_level TEXT,
    overall_risk_category TEXT,
    overall_risk_score NUMERIC,
    assessed_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 4. symptoms
-- =============================================================================
CREATE TABLE IF NOT EXISTS symptoms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id),
    chest_discomfort TEXT,
    breathlessness TEXT,
    palpitations TEXT,
    fatigue_weakness TEXT,
    dizziness_blackouts TEXT,
    sleep_duration TEXT,
    stress_anxiety TEXT,
    physical_inactivity TEXT,
    diet_quality TEXT,
    family_history TEXT,
    recorded_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 5. doctors
-- =============================================================================
CREATE TABLE IF NOT EXISTS doctors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    specialization TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 6. voice_calls
-- =============================================================================
CREATE TABLE IF NOT EXISTS voice_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id),
    call_type TEXT NOT NULL,
    use_case TEXT,
    status TEXT DEFAULT 'scheduled',
    language TEXT DEFAULT 'hindi',
    transcript TEXT,
    extracted_data JSONB DEFAULT '{}'::jsonb,
    severity TEXT,
    duration_seconds INTEGER,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 7. fhir_resources
-- =============================================================================
CREATE TABLE IF NOT EXISTS fhir_resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id),
    call_id UUID REFERENCES voice_calls(id),
    resource_type TEXT NOT NULL,
    profile TEXT,
    fhir_json JSONB NOT NULL,
    snomed_codes TEXT[],
    loinc_codes TEXT[],
    review_status TEXT DEFAULT 'pending',
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 8. ai_feedback
-- =============================================================================
CREATE TABLE IF NOT EXISTS ai_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fhir_resource_id UUID REFERENCES fhir_resources(id),
    doctor_id UUID NOT NULL,
    action TEXT NOT NULL,
    original_extraction JSONB,
    corrected_extraction JSONB,
    correction_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 9. drug_brand_mapping
-- =============================================================================
CREATE TABLE IF NOT EXISTS drug_brand_mapping (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_name TEXT NOT NULL,
    inn_name TEXT NOT NULL,
    snomed_code TEXT,
    category TEXT
);

-- =============================================================================
-- 10. workflows
-- =============================================================================
CREATE TABLE IF NOT EXISTS workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT NOT NULL,
    trigger_config JSONB DEFAULT '{}'::jsonb,
    actions JSONB DEFAULT '[]'::jsonb,
    conditions JSONB DEFAULT '{}'::jsonb,
    camp_type TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 11. escalations
-- =============================================================================
CREATE TABLE IF NOT EXISTS escalations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id),
    call_id UUID REFERENCES voice_calls(id),
    severity_level TEXT NOT NULL,
    severity TEXT NOT NULL,
    reason TEXT,
    status TEXT DEFAULT 'open',
    assigned_to UUID,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 12. consents
-- =============================================================================
CREATE TABLE IF NOT EXISTS consents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id),
    purpose TEXT NOT NULL,
    scope TEXT,
    consent_mode TEXT DEFAULT 'verbal',
    granted_at TIMESTAMPTZ DEFAULT now(),
    revoked_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true
);

-- =============================================================================
-- 13. audit_log
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    user_role TEXT,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id UUID,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- Enable RLS on all tables
-- =============================================================================
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_vitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE symptoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE fhir_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE drug_brand_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- RLS Policies — permissive development mode
-- =============================================================================
CREATE POLICY allow_all ON patients FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON health_vitals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON risk_assessments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON symptoms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON doctors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON voice_calls FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON fhir_resources FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON ai_feedback FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON drug_brand_mapping FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON workflows FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON escalations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON consents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON audit_log FOR ALL USING (true) WITH CHECK (true);

-- =============================================================================
-- Seed: Workflows
-- =============================================================================
INSERT INTO workflows (name, description, trigger_type, trigger_config, actions, conditions, camp_type, is_active) VALUES
('Post-Camp Follow-Up', 'Schedule voice AI calls 48h after camp visit', 'time_based', '{"delay_hours": 48}'::jsonb, '[{"type": "voice_call", "template": "followup_checkin"}]'::jsonb, '{}'::jsonb, 'general', true),
('High-Risk Escalation', 'Auto-escalate when risk score > 60', 'risk_threshold', '{"threshold": 60}'::jsonb, '[{"type": "escalation", "severity": "HIGH"}, {"type": "notification", "channel": "sms"}]'::jsonb, '{"risk_score_gt": 60}'::jsonb, NULL, true),
('Medication Reminder', 'Daily medication reminders via WhatsApp/Voice', 'scheduled', '{"cron": "0 9 * * *"}'::jsonb, '[{"type": "whatsapp", "template": "med_reminder"}, {"type": "voice_call", "template": "med_reminder"}]'::jsonb, '{}'::jsonb, NULL, true),
('Elderly Weekly Check', 'Weekly wellness check for elderly camp patients', 'scheduled', '{"cron": "0 10 * * 1"}'::jsonb, '[{"type": "voice_call", "template": "elderly_wellness"}]'::jsonb, '{}'::jsonb, 'elderly', true);

-- =============================================================================
-- Seed: Drug Brand Mapping
-- =============================================================================
INSERT INTO drug_brand_mapping (brand_name, inn_name, snomed_code, category) VALUES
('Crocin', 'Paracetamol', '387517004', 'Analgesic'),
('Dolo', 'Paracetamol', '387517004', 'Analgesic'),
('Combiflam', 'Ibuprofen + Paracetamol', '387207008', 'Analgesic'),
('Ecosprin', 'Aspirin', '387458008', 'Antiplatelet'),
('Metformin', 'Metformin', '109081006', 'Antidiabetic'),
('Glycomet', 'Metformin', '109081006', 'Antidiabetic'),
('Jalra', 'Vildagliptin', '424759003', 'Antidiabetic'),
('Galvus', 'Vildagliptin', '424759003', 'Antidiabetic'),
('Amaryl', 'Glimepiride', '386966003', 'Antidiabetic'),
('Glucobay', 'Acarbose', '386964000', 'Antidiabetic'),
('Amlodipine', 'Amlodipine', '386864001', 'Antihypertensive'),
('Stamlo', 'Amlodipine', '386864001', 'Antihypertensive'),
('Telmisartan', 'Telmisartan', '387069000', 'Antihypertensive'),
('Telma', 'Telmisartan', '387069000', 'Antihypertensive'),
('Atenolol', 'Atenolol', '387506000', 'Antihypertensive'),
('Losartan', 'Losartan', '373567002', 'Antihypertensive'),
('Atorvastatin', 'Atorvastatin', '373444002', 'Statin'),
('Atorva', 'Atorvastatin', '373444002', 'Statin'),
('Rosuvastatin', 'Rosuvastatin', '412295007', 'Statin'),
('Rozavel', 'Rosuvastatin', '412295007', 'Statin'),
('Pantoprazole', 'Pantoprazole', '395821003', 'PPI'),
('Pan-D', 'Pantoprazole + Domperidone', '395821003', 'PPI'),
('Omeprazole', 'Omeprazole', '387137007', 'PPI'),
('Thyronorm', 'Levothyroxine', '768532004', 'Thyroid'),
('Shelcal', 'Calcium + Vitamin D3', '767101005', 'Supplement'),
('Neurobion', 'Vitamin B Complex', '768741001', 'Supplement');

-- =============================================================================
-- 14. newborns
-- =============================================================================
CREATE TABLE IF NOT EXISTS newborns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_patient_id UUID REFERENCES patients(id),
    baby_name TEXT NOT NULL,
    date_of_birth DATE NOT NULL,
    gender TEXT,
    birth_weight_kg NUMERIC,
    birth_hospital TEXT,
    phone TEXT,
    language TEXT DEFAULT 'hindi',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- 15. vaccination_schedules
-- =============================================================================
CREATE TABLE IF NOT EXISTS vaccination_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    newborn_id UUID REFERENCES newborns(id),
    vaccine_name TEXT NOT NULL,
    dose_number INTEGER DEFAULT 1,
    due_age TEXT NOT NULL,
    due_date DATE,
    route_site TEXT,
    remarks TEXT,
    status TEXT DEFAULT 'pending',
    administered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE newborns ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaccination_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_all ON newborns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY allow_all ON vaccination_schedules FOR ALL USING (true) WITH CHECK (true);

-- =============================================================================
-- Seed: Additional Workflows (UC2, UC3, UC6)
-- =============================================================================
INSERT INTO workflows (name, description, trigger_type, trigger_config, actions, conditions, camp_type, is_active) VALUES
('OPD to IPD Escalation', 'Automated follow-up after OPD visit to detect symptom deterioration and escalate to IPD.', 'event_based', '{"event": "opd_visit_completed", "delay_hours": 24}'::jsonb, '[{"type": "voice_call", "template": "opd_to_ipd"}, {"type": "escalation", "severity": "HIGH", "condition": "symptoms_worsening"}]'::jsonb, '{"has_opd_visit": true}'::jsonb, NULL, true),
('Recovery Protocol Monitoring', 'Post-discharge recovery calls on Day 1, 3, 7, 14, 30.', 'time_based', '{"schedule_days": [1, 3, 7, 14, 30], "trigger": "discharge_date"}'::jsonb, '[{"type": "voice_call", "template": "recovery_protocol"}, {"type": "escalation", "condition": "wound_infection OR medication_missed_3days"}]'::jsonb, '{"is_discharged": true}'::jsonb, NULL, true),
('Newborn Vaccination Reminders', 'Automated voice reminders for upcoming vaccinations per NIP India schedule (0-12 months).', 'time_based', '{"days_before_due": 3, "schedule": "vaccination_calendar"}'::jsonb, '[{"type": "voice_call", "template": "newborn_vaccination"}, {"type": "whatsapp", "template": "vaccination_reminder"}]'::jsonb, '{"has_newborn": true}'::jsonb, 'vaccination', true);
