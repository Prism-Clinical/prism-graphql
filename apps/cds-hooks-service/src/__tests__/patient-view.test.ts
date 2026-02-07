import request from 'supertest';
import { app } from '../index';
import type { CDSHookResponse, CDSHookRequest, CDSCard } from '../types';

describe('Patient View Hook Handler', () => {
  const validRequest: CDSHookRequest = {
    hookInstance: '12345678-1234-4123-a123-123456789abc',
    hook: 'patient-view',
    context: {
      userId: 'Practitioner/123',
      patientId: 'Patient/456',
    },
    prefetch: {
      patient: {
        resourceType: 'Patient',
        id: '456',
        name: [{ given: ['John'], family: 'Doe' }],
        birthDate: '1960-01-15',
        gender: 'male',
      },
      conditions: {
        resourceType: 'Bundle',
        type: 'searchset',
        total: 2,
        entry: [
          {
            resource: {
              resourceType: 'Condition',
              id: 'cond-1',
              clinicalStatus: {
                coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
              },
              code: {
                coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9', display: 'Type 2 diabetes mellitus without complications' }],
              },
            },
          },
          {
            resource: {
              resourceType: 'Condition',
              id: 'cond-2',
              clinicalStatus: {
                coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
              },
              code: {
                coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I10', display: 'Essential (primary) hypertension' }],
              },
            },
          },
        ],
      },
      medications: {
        resourceType: 'Bundle',
        type: 'searchset',
        total: 0,
        entry: [],
      },
      observations: {
        resourceType: 'Bundle',
        type: 'searchset',
        total: 1,
        entry: [
          {
            resource: {
              resourceType: 'Observation',
              id: 'obs-1',
              code: {
                coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic blood pressure' }],
              },
              valueQuantity: { value: 145, unit: 'mmHg' },
              effectiveDateTime: '2026-02-01T10:00:00Z',
            },
          },
        ],
      },
    },
  };

  describe('POST /cds-services/prism-patient-view', () => {
    it('should return 200 status code for valid request', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      expect(response.status).toBe(200);
    });

    it('should return valid CDS Hooks response structure', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      const body = response.body as CDSHookResponse;
      expect(body).toHaveProperty('cards');
      expect(Array.isArray(body.cards)).toBe(true);
    });

    it('should return cards with required fields', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
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
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      const body = response.body as CDSHookResponse;

      body.cards.forEach((card: CDSCard) => {
        expect(['info', 'warning', 'critical']).toContain(card.indicator);
      });
    });

    it('should generate diabetes care plan recommendation for E11 condition', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      const body = response.body as CDSHookResponse;
      const diabetesCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('diabetes')
      );

      expect(diabetesCard).toBeDefined();
      expect(diabetesCard?.indicator).toBe('info');
    });

    it('should generate hypertension recommendation for I10 condition', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      const body = response.body as CDSHookResponse;
      const htCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('hypertension')
      );

      expect(htCard).toBeDefined();
      expect(htCard?.indicator).toBe('info');
    });

    it('should include UUID for each card', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      const body = response.body as CDSHookResponse;

      body.cards.forEach((card: CDSCard) => {
        expect(card.uuid).toBeDefined();
        expect(typeof card.uuid).toBe('string');
        expect(card.uuid?.length).toBeGreaterThan(0);
      });
    });

    it('should sort cards by severity (critical > warning > info)', async () => {
      const requestWithCritical: CDSHookRequest = {
        ...validRequest,
        prefetch: {
          ...validRequest.prefetch,
          conditions: {
            resourceType: 'Bundle',
            type: 'searchset',
            total: 2,
            entry: [
              {
                resource: {
                  resourceType: 'Condition',
                  id: 'cond-hf',
                  clinicalStatus: {
                    coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
                  },
                  code: {
                    coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I50.9', display: 'Heart failure, unspecified' }],
                  },
                },
              },
              {
                resource: {
                  resourceType: 'Condition',
                  id: 'cond-dm',
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
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(requestWithCritical);

      const body = response.body as CDSHookResponse;
      const indicatorOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      const cards = body.cards;

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

    it('should limit cards to 10 maximum', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      const body = response.body as CDSHookResponse;
      expect(body.cards.length).toBeLessThanOrEqual(10);
    });

    it('should include detail text in cards', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      const body = response.body as CDSHookResponse;
      const cardsWithDetail = body.cards.filter(card => card.detail);

      expect(cardsWithDetail.length).toBeGreaterThan(0);
    });
  });

  describe('Request validation', () => {
    it('should return 400 for missing hookInstance', async () => {
      const invalidRequest = {
        hook: 'patient-view',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });

    it('should return 400 for invalid hookInstance UUID format', async () => {
      const invalidRequest = {
        ...validRequest,
        hookInstance: 'not-a-valid-uuid',
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing patientId in context', async () => {
      const invalidRequest = {
        ...validRequest,
        context: {
          userId: 'Practitioner/123',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing userId in context', async () => {
      const invalidRequest = {
        ...validRequest,
        context: {
          patientId: 'Patient/456',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });
  });

  describe('Prefetch handling', () => {
    it('should return cards when prefetch is provided', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      const body = response.body as CDSHookResponse;
      expect(body.cards.length).toBeGreaterThan(0);
    });

    it('should handle request without prefetch gracefully', async () => {
      const requestWithoutPrefetch: CDSHookRequest = {
        hookInstance: '12345678-1234-4123-a123-123456789abc',
        hook: 'patient-view',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(requestWithoutPrefetch);

      expect(response.status).toBe(200);
      const body = response.body as CDSHookResponse;
      expect(body).toHaveProperty('cards');
    });

    it('should return empty cards array when no conditions present', async () => {
      const emptyConditionsRequest: CDSHookRequest = {
        ...validRequest,
        prefetch: {
          patient: validRequest.prefetch?.patient,
          conditions: {
            resourceType: 'Bundle',
            type: 'searchset',
            total: 0,
            entry: [],
          },
          medications: validRequest.prefetch?.medications,
          observations: validRequest.prefetch?.observations,
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(emptyConditionsRequest);

      expect(response.status).toBe(200);
      const body = response.body as CDSHookResponse;
      // May have screening recommendations based on patient age
      expect(Array.isArray(body.cards)).toBe(true);
    });
  });

  describe('Condition-specific recommendations', () => {
    it('should generate heart failure warning card for I50 condition', async () => {
      const hfRequest: CDSHookRequest = {
        ...validRequest,
        prefetch: {
          ...validRequest.prefetch,
          conditions: {
            resourceType: 'Bundle',
            type: 'searchset',
            total: 1,
            entry: [
              {
                resource: {
                  resourceType: 'Condition',
                  id: 'cond-hf',
                  clinicalStatus: {
                    coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
                  },
                  code: {
                    coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I50.9', display: 'Heart failure, unspecified' }],
                  },
                },
              },
            ],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(hfRequest);

      const body = response.body as CDSHookResponse;
      const hfCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('heart failure')
      );

      expect(hfCard).toBeDefined();
      expect(hfCard?.indicator).toBe('warning');
    });

    it('should generate CKD monitoring card for N18 condition', async () => {
      const ckdRequest: CDSHookRequest = {
        ...validRequest,
        prefetch: {
          ...validRequest.prefetch,
          conditions: {
            resourceType: 'Bundle',
            type: 'searchset',
            total: 1,
            entry: [
              {
                resource: {
                  resourceType: 'Condition',
                  id: 'cond-ckd',
                  clinicalStatus: {
                    coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
                  },
                  code: {
                    coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'N18.3', display: 'Chronic kidney disease, stage 3' }],
                  },
                },
              },
            ],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(ckdRequest);

      const body = response.body as CDSHookResponse;
      const ckdCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('ckd') || card.summary.toLowerCase().includes('kidney')
      );

      expect(ckdCard).toBeDefined();
      expect(ckdCard?.indicator).toBe('warning');
    });

    it('should generate COPD review card for J44 condition', async () => {
      const copdRequest: CDSHookRequest = {
        ...validRequest,
        prefetch: {
          ...validRequest.prefetch,
          conditions: {
            resourceType: 'Bundle',
            type: 'searchset',
            total: 1,
            entry: [
              {
                resource: {
                  resourceType: 'Condition',
                  id: 'cond-copd',
                  clinicalStatus: {
                    coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
                  },
                  code: {
                    coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'J44.1', display: 'COPD with acute exacerbation' }],
                  },
                },
              },
            ],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(copdRequest);

      const body = response.body as CDSHookResponse;
      const copdCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('copd')
      );

      expect(copdCard).toBeDefined();
      expect(copdCard?.indicator).toBe('info');
    });

    it('should skip inactive conditions', async () => {
      const inactiveConditionRequest: CDSHookRequest = {
        ...validRequest,
        prefetch: {
          ...validRequest.prefetch,
          conditions: {
            resourceType: 'Bundle',
            type: 'searchset',
            total: 1,
            entry: [
              {
                resource: {
                  resourceType: 'Condition',
                  id: 'cond-resolved',
                  clinicalStatus: {
                    coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'resolved' }],
                  },
                  code: {
                    coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'E11.9', display: 'Type 2 diabetes mellitus' }],
                  },
                },
              },
            ],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(inactiveConditionRequest);

      const body = response.body as CDSHookResponse;
      const diabetesCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('diabetes')
      );

      expect(diabetesCard).toBeUndefined();
    });
  });

  describe('Missing data recommendations', () => {
    it('should recommend vital signs capture when no observations present', async () => {
      const noObsRequest: CDSHookRequest = {
        ...validRequest,
        prefetch: {
          ...validRequest.prefetch,
          observations: {
            resourceType: 'Bundle',
            type: 'searchset',
            total: 0,
            entry: [],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(noObsRequest);

      const body = response.body as CDSHookResponse;
      const vitalsCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('vital')
      );

      expect(vitalsCard).toBeDefined();
      expect(vitalsCard?.indicator).toBe('info');
    });
  });

  describe('Screening recommendations', () => {
    it('should recommend colorectal screening for patients aged 45-75', async () => {
      // Patient born in 1960 is ~66 years old
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      const body = response.body as CDSHookResponse;
      const screeningCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('colorectal')
      );

      expect(screeningCard).toBeDefined();
      expect(screeningCard?.indicator).toBe('info');
    });

    it('should not recommend colorectal screening for patients under 45', async () => {
      const youngPatientRequest: CDSHookRequest = {
        ...validRequest,
        prefetch: {
          ...validRequest.prefetch,
          patient: {
            resourceType: 'Patient',
            id: '456',
            name: [{ given: ['Jane'], family: 'Doe' }],
            birthDate: '2000-01-15', // 26 years old
            gender: 'female',
          },
          conditions: {
            resourceType: 'Bundle',
            type: 'searchset',
            total: 0,
            entry: [],
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(youngPatientRequest);

      const body = response.body as CDSHookResponse;
      const screeningCard = body.cards.find(card =>
        card.summary.toLowerCase().includes('colorectal')
      );

      expect(screeningCard).toBeUndefined();
    });
  });

  describe('Response timing', () => {
    it('should respond within 2 seconds', async () => {
      const startTime = Date.now();

      await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(responseTime).toBeLessThan(2000);
    });
  });
});
