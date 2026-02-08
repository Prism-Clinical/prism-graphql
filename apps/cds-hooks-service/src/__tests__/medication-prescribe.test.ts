import request from 'supertest';
import { app } from '../index';
import type { CDSHookResponse, CDSHookRequest, CDSCard } from '../types';

describe('Medication Prescribe Hook Handler', () => {
  const validRequest: CDSHookRequest = {
    hookInstance: '12345678-1234-4123-a123-123456789abc',
    hook: 'medication-prescribe',
    context: {
      userId: 'Practitioner/123',
      patientId: 'Patient/456',
      medications: {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'MedicationRequest',
              id: 'med-1',
              status: 'draft',
              intent: 'order',
              medicationCodeableConcept: {
                coding: [
                  {
                    system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
                    code: '860975',
                    display: 'Metformin 500 MG',
                  },
                ],
                text: 'Metformin 500 MG',
              },
            },
          },
        ],
      },
    },
    prefetch: {
      patient: {
        resourceType: 'Patient',
        id: '456',
        name: [{ given: ['John'], family: 'Doe' }],
      },
      allergies: {
        resourceType: 'Bundle',
        type: 'searchset',
        total: 0,
        entry: [],
      },
      medications: {
        resourceType: 'Bundle',
        type: 'searchset',
        total: 0,
        entry: [],
      },
      conditions: {
        resourceType: 'Bundle',
        type: 'searchset',
        total: 0,
        entry: [],
      },
      labResults: {
        resourceType: 'Bundle',
        type: 'searchset',
        total: 0,
        entry: [],
      },
    },
  };

  describe('POST /cds-services/prism-medication-prescribe', () => {
    it('should return 200 status code for valid request', async () => {
      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(validRequest);

      expect(response.status).toBe(200);
    });

    it('should return valid CDS Hooks response structure', async () => {
      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(validRequest);

      const body = response.body as CDSHookResponse;
      expect(body).toHaveProperty('cards');
      expect(Array.isArray(body.cards)).toBe(true);
    });

    it('should return cards with required fields', async () => {
      // Create a request that will generate cards
      const allergyRequest = {
        ...validRequest,
        context: {
          ...validRequest.context,
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-pcn',
                  medicationCodeableConcept: { text: 'Penicillin V' },
                },
              },
            ],
          },
        },
        prefetch: {
          ...validRequest.prefetch,
          allergies: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'AllergyIntolerance',
                  code: { text: 'Penicillin' },
                },
              },
            ],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(allergyRequest);

      const body = response.body as CDSHookResponse;

      body.cards.forEach((card: CDSCard) => {
        expect(card).toHaveProperty('summary');
        expect(card).toHaveProperty('indicator');
        expect(card).toHaveProperty('source');
        expect(card.source).toHaveProperty('label');
      });
    });

    it('should return indicator values of info, warning, or critical', async () => {
      const allergyRequest = {
        ...validRequest,
        context: {
          ...validRequest.context,
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-pcn',
                  medicationCodeableConcept: { text: 'Penicillin V' },
                },
              },
            ],
          },
        },
        prefetch: {
          ...validRequest.prefetch,
          allergies: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'AllergyIntolerance',
                  code: { text: 'Penicillin' },
                },
              },
            ],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(allergyRequest);

      const body = response.body as CDSHookResponse;

      body.cards.forEach((card: CDSCard) => {
        expect(['info', 'warning', 'critical']).toContain(card.indicator);
      });
    });

    it('should limit cards to 10 maximum', async () => {
      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(validRequest);

      const body = response.body as CDSHookResponse;
      expect(body.cards.length).toBeLessThanOrEqual(10);
    });

    it('should return empty cards array when no issues found', async () => {
      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(validRequest);

      const body = response.body as CDSHookResponse;
      expect(body.cards).toEqual([]);
    });
  });

  describe('Request validation', () => {
    it('should return 400 for missing hookInstance', async () => {
      const invalidRequest = {
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid hookInstance UUID format', async () => {
      const invalidRequest = {
        ...validRequest,
        hookInstance: 'not-a-valid-uuid',
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing medications in context', async () => {
      const invalidRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });

    it('should return 400 for wrong hook type', async () => {
      const invalidRequest = {
        ...validRequest,
        hook: 'patient-view',
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });
  });

  describe('Allergy detection', () => {
    it('should detect direct allergy match', async () => {
      const allergyRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-pcn',
                  medicationCodeableConcept: {
                    text: 'Penicillin V 500mg',
                  },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          allergies: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'AllergyIntolerance',
                  id: 'allergy-1',
                  code: { text: 'Penicillin' },
                },
              },
            ],
          },
          medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          conditions: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          labResults: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(allergyRequest);

      const body = response.body as CDSHookResponse;
      const allergyCard = body.cards.find(
        card => card.summary.toLowerCase().includes('allergy')
      );

      expect(allergyCard).toBeDefined();
      expect(allergyCard?.indicator).toBe('critical');
    });

    it('should detect cross-reactive allergy (amoxicillin for penicillin allergy)', async () => {
      const crossReactiveRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-amox',
                  medicationCodeableConcept: {
                    text: 'Amoxicillin 500mg',
                  },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          allergies: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'AllergyIntolerance',
                  code: { text: 'Penicillin' },
                },
              },
            ],
          },
          medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          conditions: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          labResults: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(crossReactiveRequest);

      const body = response.body as CDSHookResponse;
      const allergyCard = body.cards.find(
        card =>
          card.summary.toLowerCase().includes('allergy') ||
          card.summary.toLowerCase().includes('cross-reactive')
      );

      expect(allergyCard).toBeDefined();
      expect(allergyCard?.indicator).toBe('critical');
    });

    it('should include suggestion to remove medication with allergy', async () => {
      const allergyRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-pcn',
                  medicationCodeableConcept: { text: 'Penicillin V' },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          allergies: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'AllergyIntolerance',
                  code: { text: 'Penicillin' },
                },
              },
            ],
          },
          medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          conditions: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          labResults: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(allergyRequest);

      const body = response.body as CDSHookResponse;
      const allergyCard = body.cards.find(
        card => card.summary.toLowerCase().includes('allergy')
      );

      expect(allergyCard?.suggestions).toBeDefined();
      expect(allergyCard?.suggestions?.[0]?.actions?.[0]?.type).toBe('delete');
    });

    it('should detect NSAID allergy for ibuprofen prescription', async () => {
      const nsaidRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-ibu',
                  medicationCodeableConcept: { text: 'Ibuprofen 400mg' },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          allergies: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'AllergyIntolerance',
                  code: { text: 'NSAID' },
                },
              },
            ],
          },
          medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          conditions: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          labResults: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(nsaidRequest);

      const body = response.body as CDSHookResponse;
      const allergyCard = body.cards.find(
        card => card.summary.toLowerCase().includes('allergy')
      );

      expect(allergyCard).toBeDefined();
      expect(allergyCard?.indicator).toBe('critical');
    });
  });

  describe('Drug-drug interaction detection', () => {
    it('should detect warfarin-aspirin interaction', async () => {
      const interactionRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-aspirin',
                  medicationCodeableConcept: { text: 'Aspirin 81mg' },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          allergies: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          medications: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-warfarin',
                  status: 'active',
                  medicationCodeableConcept: { text: 'Warfarin 5mg' },
                },
              },
            ],
          },
          conditions: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          labResults: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(interactionRequest);

      const body = response.body as CDSHookResponse;
      const interactionCard = body.cards.find(
        card => card.summary.toLowerCase().includes('interaction')
      );

      expect(interactionCard).toBeDefined();
      expect(interactionCard?.indicator).toBe('critical');
      expect(interactionCard?.detail?.toLowerCase()).toContain('bleeding');
    });

    it('should detect simvastatin-amiodarone interaction', async () => {
      const interactionRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-simva',
                  medicationCodeableConcept: { text: 'Simvastatin 40mg' },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          allergies: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          medications: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-amio',
                  status: 'active',
                  medicationCodeableConcept: { text: 'Amiodarone 200mg' },
                },
              },
            ],
          },
          conditions: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          labResults: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(interactionRequest);

      const body = response.body as CDSHookResponse;
      const interactionCard = body.cards.find(
        card => card.summary.toLowerCase().includes('interaction')
      );

      expect(interactionCard).toBeDefined();
      expect(interactionCard?.indicator).toBe('critical');
      expect(interactionCard?.detail?.toLowerCase()).toContain('rhabdomyolysis');
    });

    it('should detect lisinopril-spironolactone hyperkalemia risk', async () => {
      const interactionRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-spiron',
                  medicationCodeableConcept: { text: 'Spironolactone 25mg' },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          allergies: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          medications: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-lisinopril',
                  status: 'active',
                  medicationCodeableConcept: { text: 'Lisinopril 10mg' },
                },
              },
            ],
          },
          conditions: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          labResults: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(interactionRequest);

      const body = response.body as CDSHookResponse;
      const interactionCard = body.cards.find(
        card => card.summary.toLowerCase().includes('interaction')
      );

      expect(interactionCard).toBeDefined();
      expect(interactionCard?.indicator).toBe('warning');
      expect(interactionCard?.detail?.toLowerCase()).toContain('potassium');
    });
  });

  describe('Condition-based contraindication detection', () => {
    it('should warn about NSAID for patient with CKD', async () => {
      const ckdRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-ibu',
                  medicationCodeableConcept: { text: 'Ibuprofen 400mg' },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          allergies: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          conditions: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'Condition',
                  id: 'cond-ckd',
                  clinicalStatus: { coding: [{ code: 'active' }] },
                  code: {
                    coding: [{ code: 'N18.3', display: 'CKD Stage 3' }],
                    text: 'Chronic kidney disease stage 3',
                  },
                },
              },
            ],
          },
          labResults: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(ckdRequest);

      const body = response.body as CDSHookResponse;
      const contraindicationCard = body.cards.find(
        card =>
          card.summary.toLowerCase().includes('contraindication') ||
          card.detail?.toLowerCase().includes('kidney')
      );

      expect(contraindicationCard).toBeDefined();
      expect(contraindicationCard?.indicator).toBe('warning');
    });

    it('should warn about TZD for patient with heart failure', async () => {
      const hfRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-pio',
                  medicationCodeableConcept: { text: 'Pioglitazone 30mg' },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          allergies: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          conditions: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'Condition',
                  id: 'cond-hf',
                  clinicalStatus: { coding: [{ code: 'active' }] },
                  code: {
                    coding: [{ code: 'I50.9', display: 'Heart failure' }],
                  },
                },
              },
            ],
          },
          labResults: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(hfRequest);

      const body = response.body as CDSHookResponse;
      const contraindicationCard = body.cards.find(
        card => card.summary.toLowerCase().includes('contraindication')
      );

      expect(contraindicationCard).toBeDefined();
      expect(contraindicationCard?.indicator).toBe('critical');
    });

    it('should warn about beta-blocker for patient with asthma', async () => {
      const asthmaRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-prop',
                  medicationCodeableConcept: { text: 'Propranolol 40mg' },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          allergies: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          conditions: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'Condition',
                  id: 'cond-asthma',
                  clinicalStatus: { coding: [{ code: 'active' }] },
                  code: {
                    coding: [{ code: 'J45.9', display: 'Asthma' }],
                  },
                },
              },
            ],
          },
          labResults: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(asthmaRequest);

      const body = response.body as CDSHookResponse;
      const contraindicationCard = body.cards.find(
        card =>
          card.summary.toLowerCase().includes('contraindication') ||
          card.detail?.toLowerCase().includes('bronchospasm')
      );

      expect(contraindicationCard).toBeDefined();
      expect(contraindicationCard?.indicator).toBe('critical');
    });
  });

  describe('Duplicate medication detection', () => {
    it('should detect duplicate medication on active list', async () => {
      const duplicateRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-new',
                  medicationCodeableConcept: {
                    coding: [{ code: '860975', display: 'Metformin 500mg' }],
                  },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          allergies: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          medications: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-existing',
                  status: 'active',
                  medicationCodeableConcept: {
                    coding: [{ code: '860975', display: 'Metformin 500mg' }],
                  },
                },
              },
            ],
          },
          conditions: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          labResults: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(duplicateRequest);

      const body = response.body as CDSHookResponse;
      const duplicateCard = body.cards.find(
        card => card.summary.toLowerCase().includes('duplicate')
      );

      expect(duplicateCard).toBeDefined();
      expect(duplicateCard?.indicator).toBe('warning');
    });
  });

  describe('Renal dosing considerations', () => {
    it('should flag metformin with elevated creatinine', async () => {
      const renalRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-metf',
                  medicationCodeableConcept: { text: 'Metformin 1000mg' },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          allergies: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          conditions: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          labResults: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'Observation',
                  id: 'lab-cr',
                  code: {
                    coding: [{ code: '2160-0', display: 'Creatinine' }],
                  },
                  valueQuantity: { value: 2.5, unit: 'mg/dL' },
                },
              },
            ],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(renalRequest);

      const body = response.body as CDSHookResponse;
      const renalCard = body.cards.find(
        card =>
          card.summary.toLowerCase().includes('renal') ||
          card.detail?.toLowerCase().includes('kidney')
      );

      expect(renalCard).toBeDefined();
      expect(renalCard?.indicator).toBe('warning');
    });

    it('should flag gabapentin with low eGFR', async () => {
      const renalRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-gaba',
                  medicationCodeableConcept: { text: 'Gabapentin 300mg' },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          allergies: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          conditions: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          labResults: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'Observation',
                  id: 'lab-egfr',
                  code: {
                    coding: [{ code: '33914-3', display: 'eGFR' }],
                  },
                  valueQuantity: { value: 45, unit: 'mL/min/1.73m2' },
                },
              },
            ],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(renalRequest);

      const body = response.body as CDSHookResponse;
      const renalCard = body.cards.find(
        card => card.summary.toLowerCase().includes('renal')
      );

      expect(renalCard).toBeDefined();
    });
  });

  describe('Card sorting', () => {
    it('should sort cards by severity (critical > warning > info)', async () => {
      // Request with multiple issues
      const mixedRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          medications: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-pcn',
                  medicationCodeableConcept: { text: 'Penicillin V' },
                },
              },
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-met',
                  medicationCodeableConcept: { text: 'Metformin 500mg' },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          allergies: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'AllergyIntolerance',
                  code: { text: 'Penicillin' },
                },
              },
            ],
          },
          medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          conditions: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          labResults: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'Observation',
                  code: { coding: [{ code: '2160-0', display: 'Creatinine' }] },
                  valueQuantity: { value: 2.0 },
                },
              },
            ],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(mixedRequest);

      const body = response.body as CDSHookResponse;
      const cards = body.cards;
      const indicatorOrder: Record<string, number> = {
        critical: 0,
        warning: 1,
        info: 2,
      };

      for (let i = 1; i < cards.length; i++) {
        const prevCard = cards[i - 1];
        const currCard = cards[i];
        if (prevCard && currCard) {
          const prevOrder = indicatorOrder[prevCard.indicator] ?? 2;
          const currOrder = indicatorOrder[currCard.indicator] ?? 2;
          expect(prevOrder).toBeLessThanOrEqual(currOrder);
        }
      }
    });
  });

  describe('Response timing', () => {
    it('should respond within 2 seconds', async () => {
      const startTime = Date.now();

      await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(validRequest);

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(responseTime).toBeLessThan(2000);
    });
  });
});
