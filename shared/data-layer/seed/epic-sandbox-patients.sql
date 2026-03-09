-- Epic Sandbox Patient Seed Data
--
-- Seeds the dev database with test patients from Epic's FHIR sandbox,
-- along with a dev clinic and provider for local development.
--
-- Usage:
--   psql -h localhost -U postgres -d healthcare_federation -f epic-sandbox-patients.sql
--
-- This script is idempotent -- safe to run multiple times.
-- All inserts use ON CONFLICT DO NOTHING so existing rows are preserved.
--
-- ============================================================================
-- Adding More Patients
-- ============================================================================
--
-- To add a new Epic sandbox patient:
--
-- 1. Look up the patient in Epic's FHIR sandbox:
--    GET https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4/Patient/{id}
--
-- 2. Copy the template below and fill in the values from the FHIR response:
--
--    INSERT INTO patients (
--        id, first_name, last_name, date_of_birth, gender,
--        medical_record_number, epic_patient_id
--    ) VALUES (
--        '00000000-0000-4000-b000-000000000NNN',  -- increment NNN
--        'FirstName',
--        'LastName',
--        'YYYY-MM-DD',
--        'male/female/other',
--        'EPIC-SEED-NNN',                          -- increment NNN
--        'epic-fhir-id-here'                       -- from FHIR Patient.id
--    ) ON CONFLICT (medical_record_number) DO NOTHING;
--
-- 3. The epic_patient_id comes from the FHIR Patient resource id field.
--    Common Epic sandbox test patients:
--      - Camila Lopez:    erXuFYUfucBZaryVksYEcMg3
--      - Derrick Lin:     eq081-VQEgP8drUUqCWzHfw3
--      - Jason Argonaut:  TgnR.yiGmEKkry0K5Rnj4kgB
--      - Linda Ross:      eIXesllypH3M9tAA5WdJftQ3
--      - Jayden Jackson:  eNO3wqOfAltfnWMfWBQ1WmQ3
--
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Institution: Prism Dev Clinic
-- ---------------------------------------------------------------------------
INSERT INTO institutions (
    id,
    name,
    type,
    address,
    phone,
    email,
    website,
    active
) VALUES (
    '00000000-0000-4000-a000-000000000001',
    'Prism Dev Clinic',
    'clinic',
    '{"street": "123 Development Ave", "city": "San Francisco", "state": "CA", "zip": "94105"}'::jsonb,
    '415-555-0100',
    'admin@prism-dev-clinic.example.com',
    'https://prism-dev-clinic.example.com',
    true
) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Provider: Dev Doctor (Internal Medicine)
-- ---------------------------------------------------------------------------
INSERT INTO providers (
    id,
    first_name,
    last_name,
    specialty,
    npi,
    license_number,
    phone,
    email,
    department,
    institution_id,
    active
) VALUES (
    '00000000-0000-4000-a000-000000000002',
    'Dev',
    'Doctor',
    'Internal Medicine',
    '1234567890',
    'DEV-LIC-001',
    '415-555-0101',
    'dev.doctor@prism-dev-clinic.example.com',
    'Primary Care',
    '00000000-0000-4000-a000-000000000001',
    true
) ON CONFLICT (npi) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Patient: Camila Lopez (Epic sandbox)
-- ---------------------------------------------------------------------------
INSERT INTO patients (
    id,
    first_name,
    last_name,
    date_of_birth,
    gender,
    medical_record_number,
    epic_patient_id
) VALUES (
    '00000000-0000-4000-b000-000000000001',
    'Camila',
    'Lopez',
    '1987-09-12',
    'female',
    'EPIC-SEED-001',
    'erXuFYUfucBZaryVksYEcMg3'
) ON CONFLICT (medical_record_number) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Patient: Derrick Lin (Epic sandbox)
-- ---------------------------------------------------------------------------
INSERT INTO patients (
    id,
    first_name,
    last_name,
    date_of_birth,
    gender,
    medical_record_number,
    epic_patient_id
) VALUES (
    '00000000-0000-4000-b000-000000000002',
    'Derrick',
    'Lin',
    '1973-06-15',
    'male',
    'EPIC-SEED-002',
    'eq081-VQEgP8drUUqCWzHfw3'
) ON CONFLICT (medical_record_number) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Patient: Jason Argonaut (Epic sandbox)
-- ---------------------------------------------------------------------------
INSERT INTO patients (
    id,
    first_name,
    last_name,
    date_of_birth,
    gender,
    medical_record_number,
    epic_patient_id
) VALUES (
    '00000000-0000-4000-b000-000000000003',
    'Jason',
    'Argonaut',
    '1985-08-01',
    'male',
    'EPIC-SEED-003',
    'TgnR.yiGmEKkry0K5Rnj4kgB'
) ON CONFLICT (medical_record_number) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Patient: Linda Ross (Epic sandbox)
-- ---------------------------------------------------------------------------
INSERT INTO patients (
    id,
    first_name,
    last_name,
    date_of_birth,
    gender,
    medical_record_number,
    epic_patient_id
) VALUES (
    '00000000-0000-4000-b000-000000000004',
    'Linda',
    'Ross',
    '1967-03-22',
    'female',
    'EPIC-SEED-004',
    'eIXesllypH3M9tAA5WdJftQ3'
) ON CONFLICT (medical_record_number) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Patient: Jayden Jackson (Epic sandbox)
-- ---------------------------------------------------------------------------
INSERT INTO patients (
    id,
    first_name,
    last_name,
    date_of_birth,
    gender,
    medical_record_number,
    epic_patient_id
) VALUES (
    '00000000-0000-4000-b000-000000000005',
    'Jayden',
    'Jackson',
    '2015-11-09',
    'male',
    'EPIC-SEED-005',
    'eNO3wqOfAltfnWMfWBQ1WmQ3'
) ON CONFLICT (medical_record_number) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Visits: Seed visits for Dev Doctor across all patients
-- ---------------------------------------------------------------------------

-- Today's visits (for todaySchedule query)
INSERT INTO visits (
    id, patient_id, provider_id, scheduled_at, type, status, chief_complaint
) VALUES
    -- Camila Lopez: morning consultation (completed)
    (
        '00000000-0000-4000-c000-000000000001',
        '00000000-0000-4000-b000-000000000001',
        '00000000-0000-4000-a000-000000000002',
        CURRENT_DATE + TIME '09:00',
        'CONSULTATION',
        'COMPLETED',
        'Annual physical exam and medication review'
    ),
    -- Derrick Lin: mid-morning follow-up (in_progress)
    (
        '00000000-0000-4000-c000-000000000002',
        '00000000-0000-4000-b000-000000000002',
        '00000000-0000-4000-a000-000000000002',
        CURRENT_DATE + TIME '10:30',
        'FOLLOW_UP',
        'IN_PROGRESS',
        'Follow-up on hypertension management'
    ),
    -- Jason Argonaut: afternoon routine (scheduled)
    (
        '00000000-0000-4000-c000-000000000003',
        '00000000-0000-4000-b000-000000000003',
        '00000000-0000-4000-a000-000000000002',
        CURRENT_DATE + TIME '14:00',
        'ROUTINE_CHECK',
        'SCHEDULED',
        'Diabetes management check-in'
    ),
    -- Linda Ross: late afternoon consultation (scheduled)
    (
        '00000000-0000-4000-c000-000000000004',
        '00000000-0000-4000-b000-000000000004',
        '00000000-0000-4000-a000-000000000002',
        CURRENT_DATE + TIME '15:30',
        'CONSULTATION',
        'SCHEDULED',
        'New patient evaluation - chronic pain'
    )
ON CONFLICT (id) DO NOTHING;

-- Update completed visit timestamps
UPDATE visits SET
    started_at = CURRENT_DATE + TIME '09:02',
    completed_at = CURRENT_DATE + TIME '09:35',
    notes = 'Patient reports feeling well. Vitals within normal limits. Continue current medications.'
WHERE id = '00000000-0000-4000-c000-000000000001';

-- Update in-progress visit timestamps
UPDATE visits SET
    started_at = CURRENT_DATE + TIME '10:32'
WHERE id = '00000000-0000-4000-c000-000000000002';

-- Past visits (for visit history)
INSERT INTO visits (
    id, patient_id, provider_id, scheduled_at, started_at, completed_at,
    type, status, chief_complaint, notes
) VALUES
    -- Camila Lopez: last week follow-up
    (
        '00000000-0000-4000-c000-000000000010',
        '00000000-0000-4000-b000-000000000001',
        '00000000-0000-4000-a000-000000000002',
        CURRENT_DATE - INTERVAL '7 days' + TIME '11:00',
        CURRENT_DATE - INTERVAL '7 days' + TIME '11:05',
        CURRENT_DATE - INTERVAL '7 days' + TIME '11:40',
        'FOLLOW_UP',
        'COMPLETED',
        'Medication adjustment follow-up',
        'Adjusted metformin dosage. Schedule labs in 2 weeks.'
    ),
    -- Derrick Lin: two weeks ago consultation
    (
        '00000000-0000-4000-c000-000000000011',
        '00000000-0000-4000-b000-000000000002',
        '00000000-0000-4000-a000-000000000002',
        CURRENT_DATE - INTERVAL '14 days' + TIME '09:00',
        CURRENT_DATE - INTERVAL '14 days' + TIME '09:03',
        CURRENT_DATE - INTERVAL '14 days' + TIME '09:45',
        'CONSULTATION',
        'COMPLETED',
        'Elevated blood pressure readings at home',
        'Started lisinopril 10mg daily. Follow up in 2 weeks.'
    ),
    -- Jayden Jackson: last month routine
    (
        '00000000-0000-4000-c000-000000000012',
        '00000000-0000-4000-b000-000000000005',
        '00000000-0000-4000-a000-000000000002',
        CURRENT_DATE - INTERVAL '30 days' + TIME '13:00',
        CURRENT_DATE - INTERVAL '30 days' + TIME '13:10',
        CURRENT_DATE - INTERVAL '30 days' + TIME '13:35',
        'ROUTINE_CHECK',
        'COMPLETED',
        'Well-child visit',
        'Growth and development on track. Immunizations up to date.'
    ),
    -- Jason Argonaut: 3 weeks ago emergency
    (
        '00000000-0000-4000-c000-000000000013',
        '00000000-0000-4000-b000-000000000003',
        '00000000-0000-4000-a000-000000000002',
        CURRENT_DATE - INTERVAL '21 days' + TIME '16:00',
        CURRENT_DATE - INTERVAL '21 days' + TIME '16:05',
        CURRENT_DATE - INTERVAL '21 days' + TIME '17:00',
        'EMERGENCY',
        'COMPLETED',
        'Hypoglycemic episode',
        'Blood glucose 52 mg/dL on arrival. Treated with oral glucose. Adjusted insulin regimen.'
    ),
    -- Linda Ross: cancelled visit
    (
        '00000000-0000-4000-c000-000000000014',
        '00000000-0000-4000-b000-000000000004',
        '00000000-0000-4000-a000-000000000002',
        CURRENT_DATE - INTERVAL '3 days' + TIME '10:00',
        NULL,
        NULL,
        'CONSULTATION',
        'CANCELLED',
        'Initial evaluation - chronic pain',
        NULL
    )
ON CONFLICT (id) DO NOTHING;

COMMIT;
