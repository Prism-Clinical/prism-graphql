import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
config();

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Mock data generators
const generateMockPatient = (patientId: string) => ({
  resourceType: 'Patient',
  id: patientId,
  identifier: [{
    use: 'usual',
    type: {
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
        code: 'MR',
        display: 'Medical Record Number'
      }]
    },
    system: 'http://example.hospital.com/patients',
    value: `MRN${patientId}`
  }],
  active: true,
  name: [{
    use: 'official',
    family: 'Johnson',
    given: ['Sarah', 'Marie'],
    prefix: ['Ms.']
  }],
  telecom: [{
    system: 'phone',
    value: '+1-555-123-4567',
    use: 'home'
  }, {
    system: 'email',
    value: 'sarah.johnson@email.com',
    use: 'home'
  }],
  gender: 'female',
  birthDate: '1985-03-15',
  address: [{
    use: 'home',
    line: ['123 Main St', 'Apt 4B'],
    city: 'Boston',
    state: 'MA',
    postalCode: '02101',
    country: 'US'
  }],
  maritalStatus: {
    coding: [{
      system: 'http://terminology.hl7.org/CodeSystem/v3-MaritalStatus',
      code: 'M',
      display: 'Married'
    }]
  }
});

const generateMockVitals = (patientId: string) => ({
  resourceType: 'Bundle',
  id: uuidv4(),
  type: 'searchset',
  total: 5,
  entry: [
    {
      resource: {
        resourceType: 'Observation',
        id: uuidv4(),
        status: 'final',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'vital-signs',
            display: 'Vital Signs'
          }]
        }],
        code: {
          coding: [{
            system: 'http://loinc.org',
            code: '8480-6',
            display: 'Systolic blood pressure'
          }]
        },
        subject: { reference: `Patient/${patientId}` },
        effectiveDateTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        valueQuantity: {
          value: 125,
          unit: 'mmHg',
          system: 'http://unitsofmeasure.org',
          code: 'mm[Hg]'
        }
      }
    },
    {
      resource: {
        resourceType: 'Observation',
        id: uuidv4(),
        status: 'final',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'vital-signs',
            display: 'Vital Signs'
          }]
        }],
        code: {
          coding: [{
            system: 'http://loinc.org',
            code: '8462-4',
            display: 'Diastolic blood pressure'
          }]
        },
        subject: { reference: `Patient/${patientId}` },
        effectiveDateTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        valueQuantity: {
          value: 80,
          unit: 'mmHg',
          system: 'http://unitsofmeasure.org',
          code: 'mm[Hg]'
        }
      }
    },
    {
      resource: {
        resourceType: 'Observation',
        id: uuidv4(),
        status: 'final',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'vital-signs',
            display: 'Vital Signs'
          }]
        }],
        code: {
          coding: [{
            system: 'http://loinc.org',
            code: '8867-4',
            display: 'Heart rate'
          }]
        },
        subject: { reference: `Patient/${patientId}` },
        effectiveDateTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        valueQuantity: {
          value: 72,
          unit: '/min',
          system: 'http://unitsofmeasure.org',
          code: '/min'
        }
      }
    }
  ]
});

const generateMockMedications = (patientId: string) => ({
  resourceType: 'Bundle',
  id: uuidv4(),
  type: 'searchset',
  total: 3,
  entry: [
    {
      resource: {
        resourceType: 'MedicationRequest',
        id: uuidv4(),
        status: 'active',
        intent: 'order',
        medicationCodeableConcept: {
          coding: [{
            system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
            code: '617993',
            display: 'Lisinopril 10 MG Oral Tablet'
          }],
          text: 'Lisinopril 10mg'
        },
        subject: { reference: `Patient/${patientId}` },
        authoredOn: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        requester: {
          display: 'Dr. Smith, Cardiology'
        },
        dosageInstruction: [{
          text: 'Take 1 tablet by mouth once daily',
          timing: {
            repeat: {
              frequency: 1,
              period: 1,
              periodUnit: 'd'
            }
          },
          route: {
            coding: [{
              system: 'http://snomed.info/sct',
              code: '26643006',
              display: 'Oral route'
            }]
          },
          doseAndRate: [{
            doseQuantity: {
              value: 1,
              unit: 'tablet',
              system: 'http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm',
              code: 'TAB'
            }
          }]
        }]
      }
    },
    {
      resource: {
        resourceType: 'MedicationRequest',
        id: uuidv4(),
        status: 'active',
        intent: 'order',
        medicationCodeableConcept: {
          coding: [{
            system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
            code: '1049502',
            display: 'Metformin 500 MG Oral Tablet'
          }],
          text: 'Metformin 500mg'
        },
        subject: { reference: `Patient/${patientId}` },
        authoredOn: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
        requester: {
          display: 'Dr. Johnson, Endocrinology'
        },
        dosageInstruction: [{
          text: 'Take 1 tablet by mouth twice daily with meals',
          timing: {
            repeat: {
              frequency: 2,
              period: 1,
              periodUnit: 'd'
            }
          },
          route: {
            coding: [{
              system: 'http://snomed.info/sct',
              code: '26643006',
              display: 'Oral route'
            }]
          }
        }]
      }
    }
  ]
});

const generateMockDiagnoses = (patientId: string) => ({
  resourceType: 'Bundle',
  id: uuidv4(),
  type: 'searchset',
  total: 2,
  entry: [
    {
      resource: {
        resourceType: 'Condition',
        id: uuidv4(),
        clinicalStatus: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: 'active',
            display: 'Active'
          }]
        },
        verificationStatus: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
            code: 'confirmed',
            display: 'Confirmed'
          }]
        },
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'encounter-diagnosis',
            display: 'Encounter Diagnosis'
          }]
        }],
        code: {
          coding: [{
            system: 'http://snomed.info/sct',
            code: '73211009',
            display: 'Diabetes mellitus'
          }],
          text: 'Type 2 Diabetes Mellitus'
        },
        subject: { reference: `Patient/${patientId}` },
        onsetDateTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
        recordedDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
      }
    },
    {
      resource: {
        resourceType: 'Condition',
        id: uuidv4(),
        clinicalStatus: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: 'active',
            display: 'Active'
          }]
        },
        verificationStatus: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
            code: 'confirmed',
            display: 'Confirmed'
          }]
        },
        code: {
          coding: [{
            system: 'http://snomed.info/sct',
            code: '38341003',
            display: 'Hypertensive disorder'
          }],
          text: 'Essential Hypertension'
        },
        subject: { reference: `Patient/${patientId}` },
        onsetDateTime: new Date(Date.now() - 500 * 24 * 60 * 60 * 1000).toISOString(),
        recordedDate: new Date(Date.now() - 500 * 24 * 60 * 60 * 1000).toISOString()
      }
    }
  ]
});

const generateMockLabResults = (patientId: string) => ({
  resourceType: 'Bundle',
  id: uuidv4(),
  type: 'searchset',
  total: 4,
  entry: [
    {
      resource: {
        resourceType: 'Observation',
        id: uuidv4(),
        status: 'final',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'laboratory',
            display: 'Laboratory'
          }]
        }],
        code: {
          coding: [{
            system: 'http://loinc.org',
            code: '2339-0',
            display: 'Glucose [Mass/volume] in Blood'
          }],
          text: 'Blood Glucose'
        },
        subject: { reference: `Patient/${patientId}` },
        effectiveDateTime: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        valueQuantity: {
          value: 118,
          unit: 'mg/dL',
          system: 'http://unitsofmeasure.org',
          code: 'mg/dL'
        },
        referenceRange: [{
          low: { value: 70, unit: 'mg/dL' },
          high: { value: 100, unit: 'mg/dL' },
          text: '70-100 mg/dL'
        }],
        interpretation: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
            code: 'H',
            display: 'High'
          }]
        }]
      }
    },
    {
      resource: {
        resourceType: 'Observation',
        id: uuidv4(),
        status: 'final',
        category: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'laboratory',
            display: 'Laboratory'
          }]
        }],
        code: {
          coding: [{
            system: 'http://loinc.org',
            code: '4548-4',
            display: 'Hemoglobin A1c/Hemoglobin.total in Blood'
          }],
          text: 'Hemoglobin A1c'
        },
        subject: { reference: `Patient/${patientId}` },
        effectiveDateTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        valueQuantity: {
          value: 7.2,
          unit: '%',
          system: 'http://unitsofmeasure.org',
          code: '%'
        },
        referenceRange: [{
          high: { value: 5.7, unit: '%' },
          text: '<5.7%'
        }]
      }
    }
  ]
});

// =============================================================================
// Mock Patient Database — for search endpoint
// =============================================================================

const MOCK_PATIENT_DATABASE = [
  {
    id: 'epic-patient-001',
    family: 'Johnson',
    given: ['Sarah', 'Marie'],
    birthDate: '1985-03-15',
    gender: 'female',
    mrn: 'MRN-10001',
  },
  {
    id: 'epic-patient-002',
    family: 'Wilson',
    given: ['James', 'Robert'],
    birthDate: '1972-08-20',
    gender: 'male',
    mrn: 'MRN-10002',
  },
  {
    id: 'epic-patient-003',
    family: 'Chen',
    given: ['Emily', 'Lin'],
    birthDate: '1990-11-05',
    gender: 'female',
    mrn: 'MRN-10003',
  },
  {
    id: 'epic-patient-004',
    family: 'Garcia',
    given: ['Carlos', 'Miguel'],
    birthDate: '1968-02-28',
    gender: 'male',
    mrn: 'MRN-10004',
  },
  {
    id: 'epic-patient-005',
    family: 'Patel',
    given: ['Priya', 'Anjali'],
    birthDate: '1995-07-12',
    gender: 'female',
    mrn: 'MRN-10005',
  },
  // Edge-case patients for null-handling testing
  {
    id: 'epic-patient-006',
    family: 'O\'Brien',
    given: ['Sean'],
    birthDate: '1980-06-01',
    gender: 'male',
    mrn: null,        // No MRN assigned
  },
  {
    id: 'epic-patient-007',
    family: 'Kim',
    given: [],         // No given name
    birthDate: '2000-12-25',
    gender: 'female',
    mrn: 'MRN-10007',
  },
];

function buildMockPatientResource(p: typeof MOCK_PATIENT_DATABASE[0]) {
  const identifiers = p.mrn
    ? [{
        use: 'usual',
        type: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
            code: 'MR',
            display: 'Medical Record Number',
          }],
        },
        system: 'http://example.hospital.com/patients',
        value: p.mrn,
      }]
    : [];

  return {
    resourceType: 'Patient',
    id: p.id,
    identifier: identifiers,
    active: true,
    name: [{
      use: 'official',
      family: p.family,
      given: p.given,
    }],
    gender: p.gender,
    birthDate: p.birthDate,
  };
}

// Auth endpoint
app.post('/auth/token', (req, res) => {
  // Simulate auth token response
  res.json({
    access_token: 'mock_token_' + Date.now(),
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'patient/*.read'
  });
});

// Metadata endpoint
app.get('/metadata', (req, res) => {
  res.json({
    resourceType: 'CapabilityStatement',
    id: 'mock-epic-server',
    version: '1.0.0',
    name: 'Mock Epic FHIR Server',
    status: 'active',
    date: new Date().toISOString(),
    publisher: 'Mock Epic System',
    description: 'Mock Epic FHIR server for testing healthcare federation'
  });
});

// Patient search endpoint — must be before /Patient/:patientId
app.get('/Patient', (req, res) => {
  const { name, family, given, birthdate, gender, identifier, _count } = req.query;
  const maxResults = _count ? parseInt(_count as string, 10) : 20;

  let results = [...MOCK_PATIENT_DATABASE];

  if (name) {
    const q = (name as string).toLowerCase();
    results = results.filter(
      (p) =>
        p.family.toLowerCase().includes(q) ||
        p.given.some((g) => g.toLowerCase().includes(q))
    );
  }
  if (family) {
    const q = (family as string).toLowerCase();
    results = results.filter((p) => p.family.toLowerCase().includes(q));
  }
  if (given) {
    const q = (given as string).toLowerCase();
    results = results.filter((p) =>
      p.given.some((g) => g.toLowerCase().includes(q))
    );
  }
  if (birthdate) {
    results = results.filter((p) => p.birthDate === birthdate);
  }
  if (gender) {
    results = results.filter((p) => p.gender === gender);
  }
  // Identifier uses exact match (not substring) per FHIR search spec
  if (identifier) {
    const q = (identifier as string).toUpperCase();
    results = results.filter((p) => p.mrn?.toUpperCase() === q);
  }

  results = results.slice(0, maxResults);

  setTimeout(() => {
    res.json({
      resourceType: 'Bundle',
      id: uuidv4(),
      type: 'searchset',
      total: results.length,
      entry: results.map((p) => ({ resource: buildMockPatientResource(p) })),
    });
  }, 50 + Math.random() * 100);
});

// Patient by ID endpoint
app.get('/Patient/:patientId', (req, res) => {
  const { patientId } = req.params;

  // Check mock database first
  const known = MOCK_PATIENT_DATABASE.find((p) => p.id === patientId);

  setTimeout(() => {
    if (known) {
      res.json(buildMockPatientResource(known));
    } else {
      res.json(generateMockPatient(patientId));
    }
  }, 100 + Math.random() * 200);
});

// Observation endpoints (vitals and labs)
app.get('/Observation', (req, res) => {
  const { patient, category } = req.query;
  
  if (!patient) {
    return res.status(400).json({ error: 'Patient parameter required' });
  }

  setTimeout(() => {
    if (category === 'vital-signs') {
      return res.json(generateMockVitals(patient as string));
    } else if (category === 'laboratory') {
      return res.json(generateMockLabResults(patient as string));
    } else {
      // Return empty bundle for other categories
      return res.json({
        resourceType: 'Bundle',
        id: uuidv4(),
        type: 'searchset',
        total: 0,
        entry: []
      });
    }
  }, 150 + Math.random() * 300);
});

// Medication endpoints
app.get('/MedicationRequest', (req, res) => {
  const { patient } = req.query;
  
  if (!patient) {
    return res.status(400).json({ error: 'Patient parameter required' });
  }

  setTimeout(() => {
    return res.json(generateMockMedications(patient as string));
  }, 120 + Math.random() * 250);
});

// Condition endpoints
app.get('/Condition', (req, res) => {
  const { patient } = req.query;
  
  if (!patient) {
    return res.status(400).json({ error: 'Patient parameter required' });
  }

  setTimeout(() => {
    return res.json(generateMockDiagnoses(patient as string));
  }, 100 + Math.random() * 200);
});

// Procedure endpoints
app.get('/Procedure', (req, res) => {
  const { patient } = req.query;
  
  if (!patient) {
    return res.status(400).json({ error: 'Patient parameter required' });
  }

  setTimeout(() => {
    return res.json({
      resourceType: 'Bundle',
      id: uuidv4(),
      type: 'searchset',
      total: 1,
      entry: [{
        resource: {
          resourceType: 'Procedure',
          id: uuidv4(),
          status: 'completed',
          code: {
            coding: [{
              system: 'http://snomed.info/sct',
              code: '225358003',
              display: 'Wound care'
            }],
            text: 'Wound care management'
          },
          subject: { reference: `Patient/${patient}` },
          performedDateTime: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
          performer: [{
            actor: { display: 'Nurse Wilson' }
          }]
        }
      }]
    });
  }, 110 + Math.random() * 220);
});

// Encounter endpoints
app.get('/Encounter', (req, res) => {
  const { patient } = req.query;
  
  if (!patient) {
    return res.status(400).json({ error: 'Patient parameter required' });
  }

  setTimeout(() => {
    return res.json({
      resourceType: 'Bundle',
      id: uuidv4(),
      type: 'searchset',
      total: 2,
      entry: [
        {
          resource: {
            resourceType: 'Encounter',
            id: uuidv4(),
            status: 'finished',
            class: {
              system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
              code: 'AMB',
              display: 'ambulatory'
            },
            type: [{
              coding: [{
                system: 'http://snomed.info/sct',
                code: '185349003',
                display: 'Encounter for check up'
              }],
              text: 'Annual Physical'
            }],
            subject: { reference: `Patient/${patient}` },
            period: {
              start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
              end: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString()
            },
            participant: [{
              individual: { display: 'Dr. Smith, Family Medicine' }
            }]
          }
        }
      ]
    });
  }, 130 + Math.random() * 270);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(port, () => {
  console.log(`🏥 Mock Epic FHIR Server running on port ${port}`);
  console.log(`📋 Health check: http://localhost:${port}/health`);
  console.log(`🔗 Metadata: http://localhost:${port}/metadata`);
});