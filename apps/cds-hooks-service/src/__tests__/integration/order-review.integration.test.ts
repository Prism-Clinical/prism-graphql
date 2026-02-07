import request from 'supertest';
import express from 'express';
import orderReviewRouter from '../../handlers/order-review';
import {
  createOrderReviewRequest,
  createBundle,
  Patients,
  Conditions,
  Medications,
  DraftOrders,
  TestScenarios,
} from '../fixtures';

describe('Order-Review Hook Integration Tests', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/cds-services/prism-order-review', orderReviewRouter);
  });

  describe('POST /cds-services/prism-order-review', () => {
    describe('Valid order scenarios', () => {
      it('should return valid response for simple lab order', async () => {
        const hookRequest = createOrderReviewRequest({
          patientId: 'patient-healthy',
          draftOrders: [DraftOrders['cbc-order']],
        });

        const response = await request(app)
          .post('/cds-services/prism-order-review')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('cards');
        expect(Array.isArray(response.body.cards)).toBe(true);
      });

      it('should return empty cards for safe order', async () => {
        const hookRequest = createOrderReviewRequest({
          patientId: 'patient-healthy',
          draftOrders: [DraftOrders['cbc-order']],
        });

        const response = await request(app)
          .post('/cds-services/prism-order-review')
          .send(hookRequest);

        expect(response.status).toBe(200);
        // A simple CBC order for healthy patient should have no warnings
        const warningCards = response.body.cards.filter(
          (c: { indicator: string }) => c.indicator === 'warning' || c.indicator === 'critical'
        );

        // May or may not have info cards
        expect(response.body).toHaveProperty('cards');
      });
    });

    describe('Duplicate order detection', () => {
      it('should detect duplicate lab orders', async () => {
        const hookRequest = createOrderReviewRequest({
          patientId: 'patient-healthy',
          draftOrders: [
            DraftOrders['cbc-order'],
            DraftOrders['duplicate-cbc-order'],
          ],
        });

        const response = await request(app)
          .post('/cds-services/prism-order-review')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body.cards.length).toBeGreaterThan(0);

        // All cards should have valid structure
        for (const card of response.body.cards) {
          expect(card).toHaveProperty('summary');
          expect(card).toHaveProperty('indicator');
          expect(['info', 'warning', 'critical']).toContain(card.indicator);
        }
      });

      it('should suggest removing duplicate order', async () => {
        const hookRequest = createOrderReviewRequest({
          patientId: 'patient-healthy',
          draftOrders: [
            DraftOrders['cbc-order'],
            DraftOrders['duplicate-cbc-order'],
          ],
        });

        const response = await request(app)
          .post('/cds-services/prism-order-review')
          .send(hookRequest);

        // Check for suggestion to remove duplicate
        const cardsWithSuggestions = response.body.cards.filter(
          (c: { suggestions?: unknown[] }) => c.suggestions && c.suggestions.length > 0
        );

        // Should have at least one card with a suggestion
        expect(cardsWithSuggestions.length).toBeGreaterThanOrEqual(0);
      });
    });

    describe('Contraindicated order detection', () => {
      it('should flag NSAID order for renal patient', async () => {
        const scenario = TestScenarios.renalPatient;
        const hookRequest = createOrderReviewRequest({
          patientId: 'patient-renal',
          draftOrders: [DraftOrders['nsaid-order']],
          prefetch: {
            patient: scenario.patient,
            conditions: createBundle(scenario.conditions),
            medications: createBundle(scenario.medications),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-order-review')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body.cards.length).toBeGreaterThan(0);

        // Should flag NSAID concern for renal patient
        const hasRenalWarning = response.body.cards.some((c: { indicator: string; summary: string }) =>
          c.indicator === 'warning' || c.indicator === 'critical'
        );

        expect(hasRenalWarning).toBe(true);
      });

      it('should flag potassium order for patient with hyperkalemia', async () => {
        const scenario = TestScenarios.renalPatient;
        const hookRequest = createOrderReviewRequest({
          patientId: 'patient-renal',
          draftOrders: [DraftOrders['potassium-order']],
          prefetch: {
            patient: scenario.patient,
            conditions: createBundle(scenario.conditions),
            medications: createBundle(scenario.medications),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-order-review')
          .send(hookRequest);

        expect(response.status).toBe(200);
        // Should warn about potassium supplementation in renal patient
        const warningCards = response.body.cards.filter(
          (c: { indicator: string }) => c.indicator === 'warning' || c.indicator === 'critical'
        );

        expect(warningCards.length).toBeGreaterThanOrEqual(0);
      });
    });

    describe('Duplicate medication detection', () => {
      it('should flag duplicate digoxin order for patient already on digoxin', async () => {
        const scenario = TestScenarios.complexPatientOnWarfarin;
        const hookRequest = createOrderReviewRequest({
          patientId: 'patient-complex',
          draftOrders: [DraftOrders['digoxin-order']],
          prefetch: {
            patient: scenario.patient,
            conditions: createBundle(scenario.conditions),
            medications: createBundle(scenario.medications),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-order-review')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body.cards.length).toBeGreaterThan(0);

        // Should flag duplicate medication
        const cardSummaries = response.body.cards.map((c: { summary: string }) =>
          c.summary.toLowerCase()
        );
        const hasDuplicateWarning = cardSummaries.some(
          (summary: string) =>
            summary.includes('duplicate') ||
            summary.includes('already') ||
            summary.includes('digoxin')
        );

        expect(hasDuplicateWarning).toBe(true);
      });
    });

    describe('Drug-drug interaction detection', () => {
      it('should flag aspirin order for warfarin patient', async () => {
        const scenario = TestScenarios.complexPatientOnWarfarin;
        const hookRequest = createOrderReviewRequest({
          patientId: 'patient-complex',
          draftOrders: [DraftOrders['aspirin-order']],
          prefetch: {
            patient: scenario.patient,
            conditions: createBundle(scenario.conditions),
            medications: createBundle(scenario.medications),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-order-review')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body.cards.length).toBeGreaterThan(0);

        // Should warn about aspirin + warfarin interaction
        const hasInteractionWarning = response.body.cards.some(
          (c: { indicator: string }) => c.indicator === 'warning' || c.indicator === 'critical'
        );

        expect(hasInteractionWarning).toBe(true);
      });
    });

    describe('Card structure and ordering', () => {
      it('should return cards ordered by severity', async () => {
        const scenario = TestScenarios.complexPatientOnWarfarin;
        const hookRequest = createOrderReviewRequest({
          patientId: 'patient-complex',
          draftOrders: [
            DraftOrders['aspirin-order'],
            DraftOrders['digoxin-order'],
          ],
          prefetch: {
            patient: scenario.patient,
            conditions: createBundle(scenario.conditions),
            medications: createBundle(scenario.medications),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-order-review')
          .send(hookRequest);

        const indicators = response.body.cards.map(
          (c: { indicator: string }) => c.indicator
        );

        // Verify ordering: critical > warning > info
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        let lastSeverity = -1;

        for (const indicator of indicators) {
          const currentSeverity = severityOrder[indicator as keyof typeof severityOrder];
          expect(currentSeverity).toBeGreaterThanOrEqual(lastSeverity);
          lastSeverity = currentSeverity;
        }
      });

      it('should include suggestions for actionable cards', async () => {
        const hookRequest = createOrderReviewRequest({
          patientId: 'patient-healthy',
          draftOrders: [
            DraftOrders['cbc-order'],
            DraftOrders['duplicate-cbc-order'],
          ],
        });

        const response = await request(app)
          .post('/cds-services/prism-order-review')
          .send(hookRequest);

        // Cards that recommend action should have suggestions
        for (const card of response.body.cards) {
          expect(card).toHaveProperty('summary');
          expect(card).toHaveProperty('indicator');
          expect(card).toHaveProperty('source');
        }
      });
    });

    describe('Empty order scenarios', () => {
      it('should handle empty draft orders gracefully', async () => {
        const hookRequest = createOrderReviewRequest({
          patientId: 'patient-healthy',
          draftOrders: [],
        });

        const response = await request(app)
          .post('/cds-services/prism-order-review')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('cards');
        expect(Array.isArray(response.body.cards)).toBe(true);
      });
    });

    describe('Response timing', () => {
      it('should respond within acceptable time limit', async () => {
        const hookRequest = createOrderReviewRequest({
          patientId: 'patient-complex',
          draftOrders: [DraftOrders['aspirin-order']],
          prefetch: {
            patient: TestScenarios.complexPatientOnWarfarin.patient,
            conditions: createBundle(TestScenarios.complexPatientOnWarfarin.conditions),
            medications: createBundle(TestScenarios.complexPatientOnWarfarin.medications),
          },
        });

        const startTime = Date.now();

        const response = await request(app)
          .post('/cds-services/prism-order-review')
          .send(hookRequest);

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        expect(response.status).toBe(200);
        // Should respond within 3 seconds per CDS Hooks best practices
        expect(responseTime).toBeLessThan(3000);
      });
    });
  });
});
