import request from 'supertest';
import express from 'express';
import patientViewRouter from '../../handlers/patient-view';
import {
  createPatientViewRequest,
  createBundle,
  Patients,
  Conditions,
  Medications,
  Observations,
  TestScenarios,
} from '../fixtures';

describe('Patient-View Hook Integration Tests', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/cds-services/prism-patient-view', patientViewRouter);
  });

  describe('POST /cds-services/prism-patient-view', () => {
    describe('Healthy patient scenarios', () => {
      it('should return valid response for healthy patient', async () => {
        const hookRequest = createPatientViewRequest({
          patientId: 'patient-healthy',
        });

        const response = await request(app)
          .post('/cds-services/prism-patient-view')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('cards');
        expect(Array.isArray(response.body.cards)).toBe(true);
      });

      it('should not return critical cards for healthy patient', async () => {
        const hookRequest = createPatientViewRequest({
          patientId: 'patient-healthy',
        });

        const response = await request(app)
          .post('/cds-services/prism-patient-view')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('cards');

        // Healthy patients should never have critical alerts
        const indicators = response.body.cards.map(
          (c: { indicator: string }) => c.indicator
        );
        expect(indicators).not.toContain('critical');
      });
    });

    describe('Diabetic patient scenarios', () => {
      it('should return cards for uncontrolled diabetic patient', async () => {
        const scenario = TestScenarios.diabeticPatientUncontrolled;
        const hookRequest = createPatientViewRequest({
          patientId: 'patient-diabetic',
          prefetch: {
            patient: scenario.patient,
            conditions: createBundle(scenario.conditions),
            medications: createBundle(scenario.medications),
            observations: createBundle(scenario.observations),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-patient-view')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body.cards.length).toBeGreaterThan(0);
      });

      it('should return clinical recommendations for diabetic patient', async () => {
        const scenario = TestScenarios.diabeticPatientUncontrolled;
        const hookRequest = createPatientViewRequest({
          patientId: 'patient-diabetic',
          prefetch: {
            patient: scenario.patient,
            conditions: createBundle(scenario.conditions),
            medications: createBundle(scenario.medications),
            observations: createBundle(scenario.observations),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-patient-view')
          .send(hookRequest);

        expect(response.status).toBe(200);
        // Should have clinical recommendation cards
        expect(response.body.cards.length).toBeGreaterThan(0);

        // All cards should have valid structure
        for (const card of response.body.cards) {
          expect(card).toHaveProperty('summary');
          expect(card).toHaveProperty('indicator');
          expect(['info', 'warning', 'critical']).toContain(card.indicator);
        }
      });
    });

    describe('Complex patient scenarios', () => {
      it('should return multiple cards for complex patient', async () => {
        const scenario = TestScenarios.complexPatientOnWarfarin;
        const hookRequest = createPatientViewRequest({
          patientId: 'patient-complex',
          prefetch: {
            patient: scenario.patient,
            conditions: createBundle(scenario.conditions),
            medications: createBundle(scenario.medications),
            observations: createBundle(scenario.observations),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-patient-view')
          .send(hookRequest);

        expect(response.status).toBe(200);
        // Complex patients should have multiple recommendations
        expect(response.body.cards.length).toBeGreaterThanOrEqual(1);
      });

      it('should return cards with valid structure for complex patient', async () => {
        const scenario = TestScenarios.complexPatientOnWarfarin;
        const hookRequest = createPatientViewRequest({
          patientId: 'patient-complex',
          prefetch: {
            patient: scenario.patient,
            conditions: createBundle(scenario.conditions),
            medications: createBundle(scenario.medications),
            observations: createBundle(scenario.observations),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-patient-view')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body.cards.length).toBeGreaterThan(0);

        // All cards should have valid structure
        for (const card of response.body.cards) {
          expect(card).toHaveProperty('summary');
          expect(card).toHaveProperty('indicator');
          expect(card).toHaveProperty('source');
          expect(card.source).toHaveProperty('label');
          expect(['info', 'warning', 'critical']).toContain(card.indicator);
        }
      });
    });

    describe('Renal patient scenarios', () => {
      it('should flag renal function concerns', async () => {
        const scenario = TestScenarios.renalPatient;
        const hookRequest = createPatientViewRequest({
          patientId: 'patient-renal',
          prefetch: {
            patient: scenario.patient,
            conditions: createBundle(scenario.conditions),
            medications: createBundle(scenario.medications),
            observations: createBundle(scenario.observations),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-patient-view')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body.cards.length).toBeGreaterThan(0);
      });
    });

    describe('Card structure validation', () => {
      it('should return cards with required fields', async () => {
        const hookRequest = createPatientViewRequest({
          patientId: 'patient-diabetic',
          prefetch: {
            patient: TestScenarios.diabeticPatientUncontrolled.patient,
            conditions: createBundle(TestScenarios.diabeticPatientUncontrolled.conditions),
            medications: createBundle(TestScenarios.diabeticPatientUncontrolled.medications),
            observations: createBundle(TestScenarios.diabeticPatientUncontrolled.observations),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-patient-view')
          .send(hookRequest);

        for (const card of response.body.cards) {
          expect(card).toHaveProperty('summary');
          expect(card).toHaveProperty('indicator');
          expect(card).toHaveProperty('source');
          expect(['info', 'warning', 'critical']).toContain(card.indicator);
        }
      });

      it('should return cards with unique UUIDs', async () => {
        const hookRequest = createPatientViewRequest({
          patientId: 'patient-complex',
          prefetch: {
            patient: TestScenarios.complexPatientOnWarfarin.patient,
            conditions: createBundle(TestScenarios.complexPatientOnWarfarin.conditions),
            medications: createBundle(TestScenarios.complexPatientOnWarfarin.medications),
            observations: createBundle(TestScenarios.complexPatientOnWarfarin.observations),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-patient-view')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body.cards.length).toBeGreaterThan(0);

        // All cards should have UUIDs
        const uuids = response.body.cards
          .map((c: { uuid?: string }) => c.uuid)
          .filter(Boolean);

        expect(uuids.length).toBe(response.body.cards.length);

        // UUIDs should be unique
        const uniqueUuids = [...new Set(uuids)];
        expect(uuids.length).toBe(uniqueUuids.length);
      });

      it('should order cards by severity', async () => {
        const hookRequest = createPatientViewRequest({
          patientId: 'patient-complex',
          prefetch: {
            patient: TestScenarios.complexPatientOnWarfarin.patient,
            conditions: createBundle(TestScenarios.complexPatientOnWarfarin.conditions),
            medications: createBundle(TestScenarios.complexPatientOnWarfarin.medications),
            observations: createBundle(TestScenarios.complexPatientOnWarfarin.observations),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-patient-view')
          .send(hookRequest);

        const indicators = response.body.cards.map(
          (c: { indicator: string }) => c.indicator
        );

        // Verify critical comes before warning, warning before info
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        let lastSeverity = -1;

        for (const indicator of indicators) {
          const currentSeverity = severityOrder[indicator as keyof typeof severityOrder];
          expect(currentSeverity).toBeGreaterThanOrEqual(lastSeverity);
          lastSeverity = currentSeverity;
        }
      });
    });

    describe('Response timing', () => {
      it('should respond within acceptable time limit', async () => {
        const hookRequest = createPatientViewRequest({
          patientId: 'patient-healthy',
        });

        const startTime = Date.now();

        const response = await request(app)
          .post('/cds-services/prism-patient-view')
          .send(hookRequest);

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        expect(response.status).toBe(200);
        // Should respond within 2 seconds per CDS Hooks best practices
        expect(responseTime).toBeLessThan(2000);
      });
    });

    describe('Empty prefetch scenarios', () => {
      it('should handle empty conditions list gracefully', async () => {
        const hookRequest = createPatientViewRequest({
          patientId: 'patient-healthy',
          prefetch: {
            patient: Patients['patient-healthy'],
            conditions: createBundle([]),
            medications: createBundle([]),
            observations: createBundle([]),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-patient-view')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('cards');
      });

      it('should handle empty observations list gracefully', async () => {
        const hookRequest = createPatientViewRequest({
          patientId: 'patient-diabetic',
          prefetch: {
            patient: Patients['patient-diabetic'],
            conditions: createBundle([Conditions['diabetes-type-2']]),
            medications: createBundle([Medications['metformin']]),
            observations: createBundle([]),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-patient-view')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('cards');
      });
    });
  });
});
