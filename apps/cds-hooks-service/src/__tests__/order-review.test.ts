import request from 'supertest';
import { app } from '../index';
import type { CDSHookResponse, CDSHookRequest, CDSCard } from '../types';

describe('Order Review Hook Handler', () => {
  const validRequest: CDSHookRequest = {
    hookInstance: '12345678-1234-4123-a123-123456789abc',
    hook: 'order-review',
    context: {
      userId: 'Practitioner/123',
      patientId: 'Patient/456',
      draftOrders: {
        resourceType: 'Bundle',
        entry: [
          {
            resource: {
              resourceType: 'MedicationRequest',
              id: 'med-1',
              status: 'draft',
              intent: 'order',
              medicationCodeableConcept: {
                coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '860975', display: 'Metformin 500 MG' }],
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
      conditions: {
        resourceType: 'Bundle',
        type: 'searchset',
        total: 1,
        entry: [
          {
            resource: {
              resourceType: 'Condition',
              id: 'cond-1',
              clinicalStatus: {
                coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
              },
              code: {
                coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9', display: 'Type 2 diabetes mellitus' }],
              },
            },
          },
        ],
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
    },
  };

  describe('POST /cds-services/prism-order-review', () => {
    it('should return 200 status code for valid request', async () => {
      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(validRequest);

      expect(response.status).toBe(200);
    });

    it('should return valid CDS Hooks response structure', async () => {
      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(validRequest);

      const body = response.body as CDSHookResponse;
      expect(body).toHaveProperty('cards');
      expect(Array.isArray(body.cards)).toBe(true);
    });

    it('should return cards with required fields', async () => {
      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(validRequest);

      const body = response.body as CDSHookResponse;

      body.cards.forEach((card: CDSCard) => {
        expect(card).toHaveProperty('summary');
        expect(card).toHaveProperty('indicator');
        expect(card).toHaveProperty('source');
        expect(card.source).toHaveProperty('label');
      });
    });

    it('should return indicator values of info, warning, or critical', async () => {
      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(validRequest);

      const body = response.body as CDSHookResponse;

      body.cards.forEach((card: CDSCard) => {
        expect(['info', 'warning', 'critical']).toContain(card.indicator);
      });
    });

    it('should include UUID for each card', async () => {
      // Add a scenario that generates cards
      const requestWithDuplicate = {
        ...validRequest,
        prefetch: {
          ...validRequest.prefetch,
          medications: {
            resourceType: 'Bundle',
            type: 'searchset',
            total: 1,
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'active-med-1',
                  status: 'active',
                  medicationCodeableConcept: {
                    coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '860975', display: 'Metformin 500 MG' }],
                  },
                },
              },
            ],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(requestWithDuplicate);

      const body = response.body as CDSHookResponse;

      body.cards.forEach((card: CDSCard) => {
        expect(card.uuid).toBeDefined();
        expect(typeof card.uuid).toBe('string');
        expect(card.uuid?.length).toBeGreaterThan(0);
      });
    });

    it('should limit cards to 10 maximum', async () => {
      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(validRequest);

      const body = response.body as CDSHookResponse;
      expect(body.cards.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Request validation', () => {
    it('should return 400 for missing hookInstance', async () => {
      const invalidRequest = {
        hook: 'order-review',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          draftOrders: {
            resourceType: 'Bundle',
            entry: [],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid hookInstance UUID format', async () => {
      const invalidRequest = {
        ...validRequest,
        hookInstance: 'not-a-valid-uuid',
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing draftOrders in context', async () => {
      const invalidRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'order-review',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });

    it('should return 400 for wrong hook type', async () => {
      const invalidRequest = {
        ...validRequest,
        hook: 'patient-view',
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });
  });

  describe('Duplicate order detection', () => {
    it('should detect duplicate medication with active medication list', async () => {
      const duplicateRequest: CDSHookRequest = {
        ...validRequest,
        prefetch: {
          ...validRequest.prefetch,
          medications: {
            resourceType: 'Bundle',
            type: 'searchset',
            total: 1,
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'active-med-1',
                  status: 'active',
                  medicationCodeableConcept: {
                    coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '860975', display: 'Metformin 500 MG' }],
                  },
                },
              },
            ],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(duplicateRequest);

      const body = response.body as CDSHookResponse;
      const duplicateCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('duplicate')
      );

      expect(duplicateCard).toBeDefined();
      expect(duplicateCard?.indicator).toBe('warning');
    });

    it('should include suggestion to remove duplicate order', async () => {
      const duplicateRequest: CDSHookRequest = {
        ...validRequest,
        prefetch: {
          ...validRequest.prefetch,
          medications: {
            resourceType: 'Bundle',
            type: 'searchset',
            total: 1,
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'active-med-1',
                  status: 'active',
                  medicationCodeableConcept: {
                    coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '860975', display: 'Metformin 500 MG' }],
                  },
                },
              },
            ],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(duplicateRequest);

      const body = response.body as CDSHookResponse;
      const duplicateCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('duplicate')
      );

      expect(duplicateCard?.suggestions).toBeDefined();
      expect(duplicateCard?.suggestions?.[0]).toHaveProperty('label');
      expect(duplicateCard?.suggestions?.[0]?.actions?.[0]?.type).toBe('delete');
    });
  });

  describe('Allergy conflict detection', () => {
    it('should detect allergy conflict with ordered medication', async () => {
      const allergyConflictRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'order-review',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          draftOrders: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-penicillin',
                  status: 'draft',
                  intent: 'order',
                  medicationCodeableConcept: {
                    coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: '7984', display: 'Penicillin V' }],
                    text: 'Penicillin V',
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
          },
          allergies: {
            resourceType: 'Bundle',
            type: 'searchset',
            total: 1,
            entry: [
              {
                resource: {
                  resourceType: 'AllergyIntolerance',
                  id: 'allergy-1',
                  clinicalStatus: {
                    coding: [{ code: 'active' }],
                  },
                  code: {
                    coding: [{ display: 'Penicillin' }],
                    text: 'Penicillin',
                  },
                },
              },
            ],
          },
          conditions: {
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
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(allergyConflictRequest);

      const body = response.body as CDSHookResponse;
      const allergyCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('allergy')
      );

      expect(allergyCard).toBeDefined();
      expect(allergyCard?.indicator).toBe('critical');
    });

    it('should detect cross-reactive allergy (amoxicillin for penicillin allergy)', async () => {
      const crossReactiveRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'order-review',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          draftOrders: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-amox',
                  status: 'draft',
                  intent: 'order',
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
                  id: 'allergy-pcn',
                  code: { text: 'Penicillin' },
                },
              },
            ],
          },
          conditions: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(crossReactiveRequest);

      const body = response.body as CDSHookResponse;
      const allergyCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('allergy')
      );

      expect(allergyCard).toBeDefined();
      expect(allergyCard?.indicator).toBe('critical');
    });
  });

  describe('Missing prerequisite detection', () => {
    it('should suggest creatinine check for metformin order', async () => {
      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(validRequest);

      const body = response.body as CDSHookResponse;
      const prereqCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('creatinine') ||
        card.detail?.toLowerCase().includes('renal')
      );

      expect(prereqCard).toBeDefined();
      expect(prereqCard?.indicator).toBe('info');
    });

    it('should include suggestion to add lab order', async () => {
      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(validRequest);

      const body = response.body as CDSHookResponse;
      const prereqCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('creatinine') ||
        card.detail?.toLowerCase().includes('renal')
      );

      expect(prereqCard?.suggestions).toBeDefined();
      expect(prereqCard?.suggestions?.[0]?.actions?.[0]?.type).toBe('create');
    });

    it('should suggest potassium check for lisinopril order', async () => {
      const lisinoprilRequest: CDSHookRequest = {
        ...validRequest,
        context: {
          ...validRequest.context,
          draftOrders: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-lis',
                  status: 'draft',
                  intent: 'order',
                  medicationCodeableConcept: {
                    text: 'Lisinopril 10mg',
                  },
                },
              },
            ],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(lisinoprilRequest);

      const body = response.body as CDSHookResponse;
      const prereqCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('potassium')
      );

      expect(prereqCard).toBeDefined();
    });
  });

  describe('Condition-based conflict detection', () => {
    it('should warn about NSAID for patient with CKD', async () => {
      const ckdNsaidRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'order-review',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          draftOrders: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-nsaid',
                  status: 'draft',
                  intent: 'order',
                  medicationCodeableConcept: {
                    text: 'Ibuprofen 400mg',
                  },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
          conditions: {
            resourceType: 'Bundle',
            type: 'searchset',
            entry: [
              {
                resource: {
                  resourceType: 'Condition',
                  id: 'cond-ckd',
                  clinicalStatus: {
                    coding: [{ code: 'active' }],
                  },
                  code: {
                    coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'N18.3', display: 'CKD Stage 3' }],
                    text: 'Chronic kidney disease, stage 3',
                  },
                },
              },
            ],
          },
          allergies: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(ckdNsaidRequest);

      const body = response.body as CDSHookResponse;
      const conflictCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('conflict') ||
        card.detail?.toLowerCase().includes('kidney')
      );

      expect(conflictCard).toBeDefined();
      expect(conflictCard?.indicator).toBe('warning');
    });

    it('should warn about NSAID for patient with heart failure', async () => {
      const hfNsaidRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'order-review',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          draftOrders: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-nsaid',
                  status: 'draft',
                  medicationCodeableConcept: {
                    text: 'Naproxen 500mg',
                  },
                },
              },
            ],
          },
        },
        prefetch: {
          patient: { resourceType: 'Patient', id: '456' },
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
                    coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I50.9', display: 'Heart failure' }],
                    text: 'Heart failure',
                  },
                },
              },
            ],
          },
          allergies: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(hfNsaidRequest);

      const body = response.body as CDSHookResponse;
      const conflictCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('conflict') ||
        card.detail?.toLowerCase().includes('heart failure')
      );

      expect(conflictCard).toBeDefined();
      expect(conflictCard?.indicator).toBe('warning');
    });
  });

  describe('Card sorting', () => {
    it('should sort cards by severity (critical > warning > info)', async () => {
      // Request with both allergy conflict (critical) and missing prereq (info)
      const mixedRequest: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'order-review',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          draftOrders: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-1',
                  medicationCodeableConcept: { text: 'Metformin 500mg' },
                },
              },
              {
                resource: {
                  resourceType: 'MedicationRequest',
                  id: 'med-2',
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
          conditions: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(mixedRequest);

      const body = response.body as CDSHookResponse;
      const cards = body.cards;
      const indicatorOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };

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

  describe('Empty orders handling', () => {
    it('should return empty cards array when no draft orders present', async () => {
      const emptyOrdersRequest: CDSHookRequest = {
        ...validRequest,
        context: {
          ...validRequest.context,
          draftOrders: {
            resourceType: 'Bundle',
            entry: [],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(emptyOrdersRequest);

      const body = response.body as CDSHookResponse;
      expect(body.cards).toEqual([]);
    });
  });

  describe('Service request handling', () => {
    it('should handle ServiceRequest orders', async () => {
      const serviceRequestOrder: CDSHookRequest = {
        ...validRequest,
        context: {
          ...validRequest.context,
          draftOrders: {
            resourceType: 'Bundle',
            entry: [
              {
                resource: {
                  resourceType: 'ServiceRequest',
                  id: 'lab-1',
                  status: 'draft',
                  intent: 'order',
                  code: {
                    coding: [{ system: 'http://loinc.org', code: '2339-0', display: 'Glucose' }],
                    text: 'Glucose',
                  },
                },
              },
            ],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(serviceRequestOrder);

      expect(response.status).toBe(200);
      const body = response.body as CDSHookResponse;
      expect(body).toHaveProperty('cards');
    });
  });

  describe('Response timing', () => {
    it('should respond within 3 seconds', async () => {
      const startTime = Date.now();

      await request(app)
        .post('/cds-services/prism-order-review')
        .send(validRequest);

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(responseTime).toBeLessThan(3000);
    });
  });
});
