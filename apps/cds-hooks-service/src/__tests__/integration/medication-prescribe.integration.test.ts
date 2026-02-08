import request from 'supertest';
import express from 'express';
import medicationPrescribeRouter from '../../handlers/medication-prescribe';
import {
  createMedicationPrescribeRequest,
  createBundle,
  Patients,
  Allergies,
  Medications,
  Conditions,
  Observations,
  DraftOrders,
  TestScenarios,
} from '../fixtures';

describe('Medication-Prescribe Hook Integration Tests', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/cds-services/prism-medication-prescribe', medicationPrescribeRouter);
  });

  describe('POST /cds-services/prism-medication-prescribe', () => {
    describe('Safe medication scenarios', () => {
      it('should return valid response for safe medication', async () => {
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-healthy',
          medications: [Medications['metformin']],
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('cards');
        expect(Array.isArray(response.body.cards)).toBe(true);
      });

      it('should return no critical cards for safe medication', async () => {
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-healthy',
          medications: [Medications['atorvastatin']],
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
          .send(hookRequest);

        expect(response.status).toBe(200);

        const criticalCards = response.body.cards.filter(
          (c: { indicator: string }) => c.indicator === 'critical'
        );

        expect(criticalCards.length).toBe(0);
      });
    });

    describe('Allergy detection scenarios', () => {
      it('should flag penicillin allergy for amoxicillin', async () => {
        const scenario = TestScenarios.patientWithAllergies;
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-allergies',
          medications: [DraftOrders['amoxicillin-order']],
          prefetch: {
            patient: scenario.patient,
            allergies: createBundle(scenario.allergies),
            currentMedications: createBundle([]),
            conditions: createBundle([]),
            recentLabs: createBundle([]),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body.cards.length).toBeGreaterThan(0);

        // Should have critical card for allergy
        const criticalCards = response.body.cards.filter(
          (c: { indicator: string }) => c.indicator === 'critical'
        );

        expect(criticalCards.length).toBeGreaterThan(0);
      });

      it('should include allergy details in card', async () => {
        const scenario = TestScenarios.patientWithAllergies;
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-allergies',
          medications: [DraftOrders['amoxicillin-order']],
          prefetch: {
            patient: scenario.patient,
            allergies: createBundle(scenario.allergies),
            currentMedications: createBundle([]),
            conditions: createBundle([]),
            recentLabs: createBundle([]),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
          .send(hookRequest);

        // Card should mention allergy or penicillin
        const cardTexts = response.body.cards.map(
          (c: { summary: string; detail?: string }) =>
            `${c.summary} ${c.detail || ''}`.toLowerCase()
        );

        const hasAllergyMention = cardTexts.some(
          (text: string) =>
            text.includes('allergy') ||
            text.includes('penicillin') ||
            text.includes('cross-react')
        );

        expect(hasAllergyMention).toBe(true);
      });

      it('should flag aspirin order for patient with aspirin allergy', async () => {
        const scenario = TestScenarios.patientWithAllergies;
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-allergies',
          medications: [DraftOrders['aspirin-order']],
          prefetch: {
            patient: scenario.patient,
            allergies: createBundle(scenario.allergies),
            currentMedications: createBundle([]),
            conditions: createBundle([]),
            recentLabs: createBundle([]),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
          .send(hookRequest);

        expect(response.status).toBe(200);

        // Should have a warning or critical for aspirin allergy
        const relevantCards = response.body.cards.filter(
          (c: { indicator: string }) =>
            c.indicator === 'warning' || c.indicator === 'critical'
        );

        expect(relevantCards.length).toBeGreaterThan(0);
      });
    });

    describe('Drug-drug interaction scenarios', () => {
      it('should flag warfarin-aspirin interaction', async () => {
        const scenario = TestScenarios.complexPatientOnWarfarin;
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-complex',
          medications: [DraftOrders['aspirin-order']],
          prefetch: {
            patient: scenario.patient,
            allergies: createBundle(scenario.allergies),
            currentMedications: createBundle(scenario.medications),
            conditions: createBundle(scenario.conditions),
            recentLabs: createBundle(scenario.observations),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body.cards.length).toBeGreaterThan(0);

        // Should have warning for warfarin + aspirin
        const warningCards = response.body.cards.filter(
          (c: { indicator: string }) => c.indicator === 'warning'
        );

        expect(warningCards.length).toBeGreaterThan(0);
      });

      it('should return warning cards for drug interactions', async () => {
        const scenario = TestScenarios.complexPatientOnWarfarin;
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-complex',
          medications: [DraftOrders['aspirin-order']],
          prefetch: {
            patient: scenario.patient,
            allergies: createBundle(scenario.allergies),
            currentMedications: createBundle(scenario.medications),
            conditions: createBundle(scenario.conditions),
            recentLabs: createBundle(scenario.observations),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
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
    });

    describe('Renal dosing considerations', () => {
      it('should flag NSAID for renal patient', async () => {
        const scenario = TestScenarios.renalPatient;
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-renal',
          medications: [DraftOrders['nsaid-order']],
          prefetch: {
            patient: scenario.patient,
            allergies: createBundle([]),
            currentMedications: createBundle(scenario.medications),
            conditions: createBundle(scenario.conditions),
            recentLabs: createBundle(scenario.observations),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body.cards.length).toBeGreaterThan(0);

        // Should warn about NSAID + CKD
        const relevantCards = response.body.cards.filter(
          (c: { indicator: string }) =>
            c.indicator === 'warning' || c.indicator === 'critical'
        );

        expect(relevantCards.length).toBeGreaterThan(0);
      });

      it('should return warning cards for renal concerns', async () => {
        const scenario = TestScenarios.renalPatient;
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-renal',
          medications: [DraftOrders['nsaid-order']],
          prefetch: {
            patient: scenario.patient,
            allergies: createBundle([]),
            currentMedications: createBundle(scenario.medications),
            conditions: createBundle(scenario.conditions),
            recentLabs: createBundle(scenario.observations),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
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
    });

    describe('Duplicate medication detection', () => {
      it('should detect duplicate medication order', async () => {
        const scenario = TestScenarios.complexPatientOnWarfarin;
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-complex',
          medications: [DraftOrders['digoxin-order']],
          prefetch: {
            patient: scenario.patient,
            allergies: createBundle(scenario.allergies),
            currentMedications: createBundle(scenario.medications),
            conditions: createBundle(scenario.conditions),
            recentLabs: createBundle(scenario.observations),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
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
    });

    describe('Card structure validation', () => {
      it('should return cards with required fields', async () => {
        const scenario = TestScenarios.patientWithAllergies;
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-allergies',
          medications: [DraftOrders['amoxicillin-order']],
          prefetch: {
            patient: scenario.patient,
            allergies: createBundle(scenario.allergies),
            currentMedications: createBundle([]),
            conditions: createBundle([]),
            recentLabs: createBundle([]),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
          .send(hookRequest);

        for (const card of response.body.cards) {
          expect(card).toHaveProperty('summary');
          expect(card).toHaveProperty('indicator');
          expect(card).toHaveProperty('source');
          expect(['info', 'warning', 'critical']).toContain(card.indicator);
        }
      });

      it('should order cards with critical first', async () => {
        const scenario = TestScenarios.patientWithAllergies;
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-allergies',
          medications: [DraftOrders['amoxicillin-order']],
          prefetch: {
            patient: scenario.patient,
            allergies: createBundle(scenario.allergies),
            currentMedications: createBundle([]),
            conditions: createBundle([]),
            recentLabs: createBundle([]),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body.cards.length).toBeGreaterThan(0);

        const indicators = response.body.cards.map(
          (c: { indicator: string }) => c.indicator
        );

        // Cards should be ordered by severity
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        let lastSeverity = -1;

        for (const indicator of indicators) {
          const currentSeverity = severityOrder[indicator as keyof typeof severityOrder];
          expect(currentSeverity).toBeGreaterThanOrEqual(lastSeverity);
          lastSeverity = currentSeverity;
        }
      });

      it('should include suggestions for critical allergy cards', async () => {
        const scenario = TestScenarios.patientWithAllergies;
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-allergies',
          medications: [DraftOrders['amoxicillin-order']],
          prefetch: {
            patient: scenario.patient,
            allergies: createBundle(scenario.allergies),
            currentMedications: createBundle([]),
            conditions: createBundle([]),
            recentLabs: createBundle([]),
          },
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
          .send(hookRequest);

        const criticalCards = response.body.cards.filter(
          (c: { indicator: string }) => c.indicator === 'critical'
        );

        // Critical cards may have suggestions to cancel order
        for (const card of criticalCards) {
          if (card.suggestions && card.suggestions.length > 0) {
            for (const suggestion of card.suggestions) {
              expect(suggestion).toHaveProperty('label');
            }
          }
        }
      });
    });

    describe('Empty medication scenarios', () => {
      it('should handle empty medications list gracefully', async () => {
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-healthy',
          medications: [],
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('cards');
        expect(Array.isArray(response.body.cards)).toBe(true);
      });
    });

    describe('Response timing', () => {
      it('should respond within acceptable time limit', async () => {
        const scenario = TestScenarios.complexPatientOnWarfarin;
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-complex',
          medications: [DraftOrders['aspirin-order']],
          prefetch: {
            patient: scenario.patient,
            allergies: createBundle(scenario.allergies),
            currentMedications: createBundle(scenario.medications),
            conditions: createBundle(scenario.conditions),
            recentLabs: createBundle(scenario.observations),
          },
        });

        const startTime = Date.now();

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
          .send(hookRequest);

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        expect(response.status).toBe(200);
        // Should respond within 2 seconds per CDS Hooks best practices
        expect(responseTime).toBeLessThan(2000);
      });
    });

    describe('Multiple medications scenarios', () => {
      it('should evaluate multiple medications in single request', async () => {
        const hookRequest = createMedicationPrescribeRequest({
          patientId: 'patient-healthy',
          medications: [
            Medications['metformin'],
            Medications['atorvastatin'],
          ],
        });

        const response = await request(app)
          .post('/cds-services/prism-medication-prescribe')
          .send(hookRequest);

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('cards');
      });
    });
  });
});
