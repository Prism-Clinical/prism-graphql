import request from 'supertest';
import express from 'express';
import discoveryRouter from '../../routes/discovery';
import patientViewRouter from '../../handlers/patient-view';
import orderReviewRouter from '../../handlers/order-review';
import medicationPrescribeRouter from '../../handlers/medication-prescribe';

describe('CDS Hooks Error Handling Integration Tests', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/cds-services', discoveryRouter);
    app.use('/cds-services/prism-patient-view', patientViewRouter);
    app.use('/cds-services/prism-order-review', orderReviewRouter);
    app.use('/cds-services/prism-medication-prescribe', medicationPrescribeRouter);

    // Error handler
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(400).json({ error: err.message });
    });
  });

  describe('Valid request handling', () => {
    it('should accept valid patient-view request', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send({
          hookInstance: '12345678-1234-4123-a123-123456789abc',
          hook: 'patient-view',
          context: {
            userId: 'Practitioner/dr-smith',
            patientId: 'patient-1',
          },
          prefetch: {
            patient: { resourceType: 'Patient', id: 'patient-1' },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('cards');
    });

    it('should accept valid order-review request', async () => {
      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send({
          hookInstance: '12345678-1234-4123-a123-123456789abc',
          hook: 'order-review',
          context: {
            userId: 'Practitioner/dr-smith',
            patientId: 'patient-1',
            draftOrders: {
              resourceType: 'Bundle',
              type: 'collection',
              entry: [],
            },
          },
          prefetch: {
            patient: { resourceType: 'Patient', id: 'patient-1' },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('cards');
    });

    it('should accept valid medication-prescribe request', async () => {
      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send({
          hookInstance: '12345678-1234-4123-a123-123456789abc',
          hook: 'medication-prescribe',
          context: {
            userId: 'Practitioner/dr-smith',
            patientId: 'patient-1',
            medications: {
              resourceType: 'Bundle',
              type: 'collection',
              entry: [],
            },
          },
          prefetch: {
            patient: { resourceType: 'Patient', id: 'patient-1' },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('cards');
    });
  });

  describe('Discovery endpoint', () => {
    it('should return services list', async () => {
      const response = await request(app).get('/cds-services');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('services');
      expect(response.body.services.length).toBe(3);
    });

    it('should return specific service by ID', async () => {
      const response = await request(app).get('/cds-services/prism-patient-view');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id', 'prism-patient-view');
    });

    it('should return 404 for unknown service ID', async () => {
      const response = await request(app).get('/cds-services/unknown-service');

      expect(response.status).toBe(404);
    });
  });

  describe('Response structure validation', () => {
    it('should return cards array in response', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send({
          hookInstance: '12345678-1234-4123-a123-123456789abc',
          hook: 'patient-view',
          context: {
            userId: 'Practitioner/dr-smith',
            patientId: 'patient-1',
          },
          prefetch: {
            patient: { resourceType: 'Patient', id: 'patient-1' },
          },
        });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.cards)).toBe(true);
    });

    it('should return cards with valid indicator values', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send({
          hookInstance: '12345678-1234-4123-a123-123456789abc',
          hook: 'patient-view',
          context: {
            userId: 'Practitioner/dr-smith',
            patientId: 'patient-1',
          },
          prefetch: {
            patient: { resourceType: 'Patient', id: 'patient-1' },
            conditions: {
              resourceType: 'Bundle',
              type: 'searchset',
              entry: [
                {
                  resource: {
                    resourceType: 'Condition',
                    id: 'cond-1',
                    code: { text: 'Diabetes' },
                    clinicalStatus: { coding: [{ code: 'active' }] },
                  },
                },
              ],
            },
          },
        });

      expect(response.status).toBe(200);

      for (const card of response.body.cards) {
        expect(['info', 'warning', 'critical']).toContain(card.indicator);
      }
    });
  });

  describe('Content-Type handling', () => {
    it('should accept application/json content type', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .set('Content-Type', 'application/json')
        .send({
          hookInstance: '12345678-1234-4123-a123-123456789abc',
          hook: 'patient-view',
          context: {
            userId: 'Practitioner/dr-smith',
            patientId: 'patient-1',
          },
          prefetch: {
            patient: { resourceType: 'Patient', id: 'patient-1' },
          },
        });

      expect(response.status).toBe(200);
    });

    it('should return JSON response', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send({
          hookInstance: '12345678-1234-4123-a123-123456789abc',
          hook: 'patient-view',
          context: {
            userId: 'Practitioner/dr-smith',
            patientId: 'patient-1',
          },
          prefetch: {
            patient: { resourceType: 'Patient', id: 'patient-1' },
          },
        });

      expect(response.headers['content-type']).toContain('application/json');
    });
  });

  describe('Graceful degradation', () => {
    it('should handle partial prefetch gracefully', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send({
          hookInstance: '12345678-1234-4123-a123-123456789abc',
          hook: 'patient-view',
          context: {
            userId: 'Practitioner/dr-smith',
            patientId: 'patient-1',
          },
          prefetch: {
            patient: { resourceType: 'Patient', id: 'patient-1' },
            // Partial prefetch - missing conditions, medications, observations
          },
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('cards');
    });

    it('should handle empty bundles in prefetch', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send({
          hookInstance: '12345678-1234-4123-a123-123456789abc',
          hook: 'patient-view',
          context: {
            userId: 'Practitioner/dr-smith',
            patientId: 'patient-1',
          },
          prefetch: {
            patient: { resourceType: 'Patient', id: 'patient-1' },
            conditions: { resourceType: 'Bundle', type: 'searchset', entry: [] },
            medications: { resourceType: 'Bundle', type: 'searchset', entry: [] },
          },
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('cards');
    });
  });

  describe('Edge cases', () => {
    it('should handle complex patient IDs', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send({
          hookInstance: '12345678-1234-4123-a123-123456789abc',
          hook: 'patient-view',
          context: {
            userId: 'Practitioner/dr-smith',
            patientId: 'patient-with-dashes-123',
          },
          prefetch: {
            patient: { resourceType: 'Patient', id: 'patient-with-dashes-123' },
          },
        });

      expect(response.status).toBe(200);
    });

    it('should handle requests with extra context fields', async () => {
      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send({
          hookInstance: '12345678-1234-4123-a123-123456789abc',
          hook: 'patient-view',
          context: {
            userId: 'Practitioner/dr-smith',
            patientId: 'patient-1',
            encounterId: 'encounter-1',
            extraField: 'extra-value',
          },
          prefetch: {
            patient: { resourceType: 'Patient', id: 'patient-1' },
          },
        });

      expect(response.status).toBe(200);
    });
  });
});
