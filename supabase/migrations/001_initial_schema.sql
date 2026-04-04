-- Swadhikaar - Database Schema
-- Supabase PostgreSQL Migration
-- Indic Voice AI Patient Engagement

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- PATIENTS (synthetic profiles + dataset vitals)
-- ============================================
CREATE TABLE patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    abha_id TEXT UNIQUE,
    name TEXT NOT NULL,
    phone TEXT,
    language TEXT DEFAULT 'hindi',
    health_camp TEXT NOT NULL,
    camp_type TEXT NOT NULL, -- general, slum, elderly, deaddiction
    risk_level TEXT, -- Low, Moderate, High
    overall_risk_score NUMERIC(5,2),
    consent_status TEXT DEFAULT 'pending', -- pending, granted, revoked
    journey_status TEXT DEFAULT 'screened', -- screened, opd_referred, ipd_admitted, recovery, chronic_management, follow_up_active
    assigned_doctor_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- HEALTH VITALS (from dataset CSV)
-- ============================================
CREATE TABLE health_vitals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    systolic_bp INTEGER,
    diastolic_bp INTEGER,
    heart_rate INTEGER,
    respiratory_rate INTEGER,
    oxygen_saturation INTEGER,
    temperature NUMERIC(5,2),
    blood_glucose INTEGER,
    height NUMERIC(5,1),
    weight NUMERIC(5,1),
    bmi NUMERIC(4,1),
    bmi_category TEXT,
    waist_circumference NUMERIC(5,1),
    waist_to_height_ratio NUMERIC(6,5),
    perfusion_index NUMERIC(4,1),
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- RISK ASSESSMENTS (from dataset)
-- ============================================
CREATE TABLE risk_assessments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    heart_risk_score NUMERIC(5,2),
    heart_risk_level TEXT,
    diabetic_risk_score NUMERIC(5,2),
    diabetic_risk_level TEXT,
    hypertension_risk_score NUMERIC(5,2),
    hypertension_risk_level TEXT,
    overall_risk_category TEXT,
    overall_risk_score NUMERIC(5,2),
    assessed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- SYMPTOMS (from dataset)
-- ============================================
CREATE TABLE symptoms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
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
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- VOICE CALLS
-- ============================================
CREATE TABLE voice_calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    call_type TEXT NOT NULL, -- follow_up, reminder, screening, chronic_check, recovery
    use_case TEXT, -- screening_to_opd, opd_to_ipd, recovery_protocol, chronic_management, follow_up
    status TEXT DEFAULT 'scheduled', -- scheduled, in_progress, completed, failed, missed
    language TEXT DEFAULT 'hindi',
    transcript TEXT,
    extracted_data JSONB DEFAULT '{}',
    severity TEXT, -- LOW, MODERATE, HIGH, CRITICAL
    duration_seconds INTEGER,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- FHIR RESOURCES
-- ============================================
CREATE TABLE fhir_resources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    call_id UUID REFERENCES voice_calls(id) ON DELETE SET NULL,
    resource_type TEXT NOT NULL, -- Observation, Condition, RiskAssessment, Encounter, MedicationStatement, AllergyIntolerance
    profile TEXT, -- opd_consultation_note, diagnostic_report_bundle, prescription_bundle, health_document_record, allergy_intolerance
    fhir_json JSONB NOT NULL,
    snomed_codes TEXT[],
    loinc_codes TEXT[],
    review_status TEXT DEFAULT 'pending', -- pending, approved, corrected, rejected
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- AI FEEDBACK (Doctor Review)
-- ============================================
CREATE TABLE ai_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fhir_resource_id UUID REFERENCES fhir_resources(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL,
    action TEXT NOT NULL, -- approve, correct, reject
    original_extraction JSONB,
    corrected_extraction JSONB,
    correction_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- DRUG BRAND MAPPING (India-specific)
-- ============================================
CREATE TABLE drug_brand_mapping (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    brand_name TEXT NOT NULL,
    inn_name TEXT NOT NULL, -- International Nonproprietary Name
    snomed_code TEXT,
    category TEXT -- analgesic, antibiotic, antidiabetic, antihypertensive, etc.
);

-- Seed common Indian drug brands
INSERT INTO drug_brand_mapping (brand_name, inn_name, snomed_code, category) VALUES
('Crocin', 'Paracetamol', '387517004', 'analgesic'),
('Dolo', 'Paracetamol', '387517004', 'analgesic'),
('Combiflam', 'Ibuprofen+Paracetamol', '387207008', 'analgesic'),
('Metformin', 'Metformin', '372567009', 'antidiabetic'),
('Glycomet', 'Metformin', '372567009', 'antidiabetic'),
('Amlodipine', 'Amlodipine', '386864001', 'antihypertensive'),
('Amlong', 'Amlodipine', '386864001', 'antihypertensive'),
('Atenolol', 'Atenolol', '387506000', 'antihypertensive'),
('Telmisartan', 'Telmisartan', '387069000', 'antihypertensive'),
('Telma', 'Telmisartan', '387069000', 'antihypertensive'),
('Ecosprin', 'Aspirin', '387458008', 'antiplatelet'),
('Azithromycin', 'Azithromycin', '396001008', 'antibiotic'),
('Augmentin', 'Amoxicillin+Clavulanate', '96068000', 'antibiotic'),
('Amoxicillin', 'Amoxicillin', '372687004', 'antibiotic'),
('Pantoprazole', 'Pantoprazole', '395821003', 'antacid'),
('Pan-D', 'Pantoprazole+Domperidone', '395821003', 'antacid'),
('Atorvastatin', 'Atorvastatin', '373444002', 'statin'),
('Atorva', 'Atorvastatin', '373444002', 'statin'),
('Insulin Glargine', 'Insulin Glargine', '411529005', 'insulin'),
('Lantus', 'Insulin Glargine', '411529005', 'insulin'),
('Glimepiride', 'Glimepiride', '386966003', 'antidiabetic'),
('Amaryl', 'Glimepiride', '386966003', 'antidiabetic'),
('Losartan', 'Losartan', '373567002', 'antihypertensive'),
('Losar', 'Losartan', '373567002', 'antihypertensive'),
('Cetirizine', 'Cetirizine', '372523007', 'antihistamine'),
('Allegra', 'Fexofenadine', '372522002', 'antihistamine');

-- ============================================
-- DOCTORS
-- ============================================
CREATE TABLE doctors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    specialization TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed doctors
INSERT INTO doctors (name, email, specialization, phone) VALUES
('Dr. Priya Sharma', 'priya@swadhikaar.in', 'General Medicine', '+919876543210'),
('Dr. Rajeev Kumar', 'rajeev@swadhikaar.in', 'Cardiology', '+919876543211'),
('Dr. Meena Patel', 'meena@swadhikaar.in', 'Pediatrics', '+919876543212');

-- ============================================
-- NEWBORNS (linked to parent patient)
-- ============================================
CREATE TABLE newborns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parent_patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    baby_name TEXT NOT NULL,
    date_of_birth DATE NOT NULL,
    gender TEXT,
    birth_weight_kg NUMERIC(4,2),
    birth_hospital TEXT,
    phone TEXT,
    language TEXT DEFAULT 'hindi',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- VACCINATION SCHEDULES (NIP India)
-- ============================================
CREATE TABLE vaccination_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    newborn_id UUID REFERENCES newborns(id) ON DELETE CASCADE,
    vaccine_name TEXT NOT NULL,
    dose_number INTEGER DEFAULT 1,
    due_age TEXT NOT NULL, -- e.g. "Birth", "6 weeks", "10 weeks"
    due_date DATE,
    route_site TEXT, -- e.g. "IM Left thigh", "Oral"
    remarks TEXT,
    status TEXT DEFAULT 'pending', -- pending, completed, overdue, skipped
    administered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- WORKFLOWS
-- ============================================
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    trigger_type TEXT NOT NULL, -- time_based, risk_based, event_based
    trigger_config JSONB DEFAULT '{}',
    actions JSONB DEFAULT '[]', -- [{type: 'voice_call', config: {...}}, {type: 'escalate', config: {...}}]
    conditions JSONB DEFAULT '{}', -- {risk_level: 'HIGH', camp_type: 'elderly'}
    camp_type TEXT, -- filter by camp type
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default workflows
INSERT INTO workflows (name, description, trigger_type, trigger_config, actions, conditions, camp_type) VALUES
(
    'Screening to OPD Follow-up',
    'Call HIGH risk patients from health camps within 24hrs',
    'risk_based',
    '{"risk_level": "High", "delay_hours": 24}',
    '[{"type": "voice_call", "template": "screening_followup"}, {"type": "escalate", "if": "severity >= HIGH"}]',
    '{"overall_risk_category": "High"}',
    NULL
),
(
    'Post-Discharge Recovery',
    'Automated recovery protocol calls on Day 1, 3, 7, 14, 30',
    'time_based',
    '{"schedule_days": [1, 3, 7, 14, 30]}',
    '[{"type": "voice_call", "template": "recovery_check"}, {"type": "escalate", "if": "medication_missed >= 3"}]',
    '{}',
    NULL
),
(
    'Chronic Monthly Check-in',
    'Monthly voice call for chronic disease patients',
    'time_based',
    '{"interval_days": 30}',
    '[{"type": "voice_call", "template": "chronic_checkin"}, {"type": "escalate", "if": "readings_abnormal"}]',
    '{"overall_risk_category": ["Moderate", "High"]}',
    NULL
),
(
    'Elderly Care - Weekly',
    'Weekly check-in for old age home patients',
    'time_based',
    '{"interval_days": 7}',
    '[{"type": "voice_call", "template": "elderly_checkin"}, {"type": "escalate", "if": "any_concern"}]',
    '{}',
    'elderly'
);

-- ============================================
-- ESCALATIONS
-- ============================================
CREATE TABLE escalations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    call_id UUID REFERENCES voice_calls(id) ON DELETE SET NULL,
    severity_level TEXT NOT NULL, -- LEVEL_1, LEVEL_2, LEVEL_3
    severity TEXT NOT NULL, -- CRITICAL, HIGH, MODERATE, LOW
    reason TEXT,
    status TEXT DEFAULT 'open', -- open, assigned, resolved, dismissed
    assigned_to UUID,
    resolved_at TIMESTAMPTZ,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CONSENTS (DPDP Act 2023)
-- ============================================
CREATE TABLE consents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL, -- health_followup, data_sharing, data_collection
    scope TEXT, -- voice_calls, health_records, doctor_sharing
    consent_mode TEXT DEFAULT 'verbal', -- verbal, portal, written
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true
);

-- ============================================
-- AUDIT LOG
-- ============================================
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID,
    user_role TEXT,
    action TEXT NOT NULL, -- data_access, consent_granted, consent_revoked, escalation_created, fhir_exported, etc.
    resource_type TEXT, -- patient, voice_call, fhir_resource, consent
    resource_id UUID,
    details JSONB DEFAULT '{}',
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_vitals ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE symptoms ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE fhir_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE newborns ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaccination_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE doctors ENABLE ROW LEVEL SECURITY;

-- Admins can do everything
CREATE POLICY "admins_full_access" ON patients FOR ALL USING (
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
);

CREATE POLICY "admins_full_access" ON health_vitals FOR ALL USING (
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
);

CREATE POLICY "admins_full_access" ON voice_calls FOR ALL USING (
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
);

CREATE POLICY "admins_full_access" ON fhir_resources FOR ALL USING (
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
);

CREATE POLICY "admins_full_access" ON escalations FOR ALL USING (
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
);

CREATE POLICY "admins_full_access" ON consents FOR ALL USING (
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
);

CREATE POLICY "admins_full_access" ON audit_log FOR ALL USING (
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
);

CREATE POLICY "admins_full_access" ON workflows FOR ALL USING (
    (SELECT raw_user_meta_data->>'role' FROM auth.users WHERE id = auth.uid()) = 'admin'
);

-- Audit log: everyone can insert
CREATE POLICY "audit_insert" ON audit_log FOR INSERT WITH CHECK (true);

-- Workflows: readable by all authenticated users
CREATE POLICY "workflows_read" ON workflows FOR SELECT USING (auth.uid() IS NOT NULL);

-- Drug brand mapping: public read
ALTER TABLE drug_brand_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drug_mapping_read" ON drug_brand_mapping FOR SELECT USING (true);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_patients_risk ON patients(risk_level);
CREATE INDEX idx_patients_camp ON patients(health_camp);
CREATE INDEX idx_patients_camp_type ON patients(camp_type);
CREATE INDEX idx_voice_calls_patient ON voice_calls(patient_id);
CREATE INDEX idx_voice_calls_status ON voice_calls(status);
CREATE INDEX idx_fhir_patient ON fhir_resources(patient_id);
CREATE INDEX idx_fhir_review ON fhir_resources(review_status);
CREATE INDEX idx_escalations_status ON escalations(status);
CREATE INDEX idx_escalations_severity ON escalations(severity);
CREATE INDEX idx_audit_log_time ON audit_log(created_at);
CREATE INDEX idx_drug_brand ON drug_brand_mapping(brand_name);
CREATE INDEX idx_newborns_parent ON newborns(parent_patient_id);
CREATE INDEX idx_vaccination_newborn ON vaccination_schedules(newborn_id);
CREATE INDEX idx_vaccination_status ON vaccination_schedules(status);
CREATE INDEX idx_patients_journey ON patients(journey_status);

-- Doctors, newborns, vaccination_schedules: readable by all authenticated
CREATE POLICY "doctors_read" ON doctors FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "newborns_read" ON newborns FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "vaccination_read" ON vaccination_schedules FOR SELECT USING (auth.uid() IS NOT NULL);
