-- SNOMED CT to ICD-10-CM common mapping table
-- Provides fallback mappings for conditions where Epic FHIR data
-- only includes SNOMED codes without an ICD-10 coding entry.

CREATE TABLE IF NOT EXISTS snomed_icd10_common_map (
  snomed_code VARCHAR(18) PRIMARY KEY,
  icd10_code  VARCHAR(10) NOT NULL REFERENCES icd10_codes(code),
  description TEXT NOT NULL
);

CREATE INDEX idx_snomed_icd10_map_icd10 ON snomed_icd10_common_map(icd10_code);

-- Seed with common primary care SNOMED-to-ICD-10 mappings
-- Source: NLM SNOMED CT to ICD-10-CM Map (1:1 mappings for high-frequency conditions)

INSERT INTO snomed_icd10_common_map (snomed_code, icd10_code, description) VALUES
-- Cardiovascular
('38341003',   'I10',    'Hypertension'),
('59621000',   'I10',    'Essential hypertension'),
('56265001',   'I25.10', 'Coronary artery disease'),
('53741008',   'I25.10', 'Coronary arteriosclerosis'),
('84114007',   'I50.9',  'Heart failure'),
('42343007',   'I50.9',  'Congestive heart failure'),
('49436004',   'I48.91', 'Atrial fibrillation'),
('5370000',    'I48.91', 'Atrial flutter'),
('22298006',   'I63.9',  'Cerebrovascular accident'),

-- Endocrine / Metabolic
('44054006',   'E11.9',  'Type 2 diabetes mellitus'),
('73211009',   'E10.9',  'Type 1 diabetes mellitus'),
('46635009',   'E10.9',  'Type 1 diabetes mellitus'),
('55822004',   'E78.5',  'Hyperlipidemia'),
('13644009',   'E78.00', 'Hypercholesterolemia'),
('238136002',  'E66.9',  'Overweight and obesity'),
('414916001',  'E66.01', 'Obesity'),
('40930008',   'E03.9',  'Hypothyroidism'),
('34486009',   'E03.9',  'Hypothyroidism, unspecified'),
('267384006',  'E03.9',  'Hypothyroidism, unspecified'),
('190268003',  'E05.90', 'Hyperthyroidism'),

-- Respiratory
('195967001',  'J45.909','Asthma'),
('233678006',  'J45.20', 'Mild intermittent asthma'),
('13645005',   'J44.1',  'COPD'),
('185086009',  'J44.1',  'COPD with acute exacerbation'),
('36971009',   'J06.9',  'Acute upper respiratory infection'),
('233604007',  'J18.9',  'Pneumonia'),
('10509002',   'J20.9',  'Acute bronchitis'),
('275544005',  'R05.9',  'Cough'),

-- Mental Health
('35489007',   'F32.9',  'Major depressive disorder'),
('370143000',  'F32.9',  'Major depressive disorder'),
('36923009',   'F32.9',  'Major depressive disorder'),
('197480006',  'F41.1',  'Generalized anxiety disorder'),
('21897009',   'F41.1',  'Generalized anxiety disorder'),
('47505003',   'F43.10', 'Post-traumatic stress disorder'),
('191736004',  'F41.0',  'Panic disorder'),
('13746004',   'F31.9',  'Bipolar disorder'),

-- Musculoskeletal
('396275006',  'M17.9',  'Osteoarthritis of knee'),
('239872002',  'M17.11', 'Primary osteoarthritis, right knee'),
('69896004',   'M54.5',  'Low back pain'),
('279039007',  'M54.5',  'Low back pain'),
('203082005',  'M25.50', 'Joint pain'),
('64859006',   'M19.90', 'Osteoarthritis'),
('76069003',   'M81.0',  'Osteoporosis'),
('443165006',  'M79.3',  'Fibromyalgia'),

-- Genitourinary
('709044004',  'N18.9',  'Chronic kidney disease'),
('431855005',  'N18.9',  'Chronic kidney disease'),
('431856006',  'N18.3',  'Chronic kidney disease, stage 3'),
('431857002',  'N18.4',  'Chronic kidney disease, stage 4'),
('68566005',   'N39.0',  'Urinary tract infection'),

-- Gastrointestinal
('235595009',  'K21.0',  'Gastroesophageal reflux disease'),
('196731005',  'K21.0',  'GERD with esophagitis'),
('34000006',   'K92.1',  'Gastrointestinal hemorrhage'),
('197321007',  'K57.30', 'Diverticulosis'),
('24526004',   'K76.0',  'Fatty liver disease'),

-- Neurological
('84757009',   'G43.909','Migraine'),
('230462002',  'G47.33', 'Obstructive sleep apnea'),
('73430006',   'G47.33', 'Sleep apnea'),
('313307000',  'G20',    'Parkinson disease'),

-- Dermatological
('43309006',   'L40.9',  'Psoriasis'),
('24079001',   'L50.9',  'Urticaria'),

-- Hematological
('87522002',   'D64.9',  'Iron deficiency anemia'),
('271737000',  'D64.9',  'Anemia'),

-- Infectious
('235871004',  'B18.2',  'Hepatitis C'),
('61462000',   'J10.1',  'Influenza'),

-- Cancer (common screenable)
('254837009',  'C50.919','Breast cancer'),
('363406005',  'C61',    'Prostate cancer'),
('363518003',  'C18.9',  'Colorectal cancer'),
('254632001',  'C34.90', 'Lung cancer'),

-- Preventive / Other
('171245007',  'Z23',    'Vaccination needed'),
('268525008',  'Z12.11', 'Screening for malignant neoplasm of colon'),
('160903007',  'Z87.891','History of tobacco use'),
('65853000',   'F17.210','Nicotine dependence, cigarettes'),
('7200002',    'F10.20', 'Alcohol dependence')

ON CONFLICT (snomed_code) DO NOTHING;
