import request from 'supertest';
import express from 'express';
import discoveryRouter from '../../routes/discovery';

describe('CDS Hooks Discovery Integration Tests', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/cds-services', discoveryRouter);
  });

  describe('GET /cds-services', () => {
    it('should return valid CDS Hooks discovery response', async () => {
      const response = await request(app).get('/cds-services');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('services');
      expect(Array.isArray(response.body.services)).toBe(true);
    });

    it('should include patient-view service', async () => {
      const response = await request(app).get('/cds-services');

      const patientViewService = response.body.services.find(
        (s: { id: string }) => s.id === 'prism-patient-view'
      );

      expect(patientViewService).toBeDefined();
      expect(patientViewService.hook).toBe('patient-view');
      expect(patientViewService.title).toBeDefined();
      expect(patientViewService.description).toBeDefined();
    });

    it('should include order-review service', async () => {
      const response = await request(app).get('/cds-services');

      const orderReviewService = response.body.services.find(
        (s: { id: string }) => s.id === 'prism-order-review'
      );

      expect(orderReviewService).toBeDefined();
      expect(orderReviewService.hook).toBe('order-review');
      expect(orderReviewService.title).toBeDefined();
      expect(orderReviewService.description).toBeDefined();
    });

    it('should include medication-prescribe service', async () => {
      const response = await request(app).get('/cds-services');

      const medicationService = response.body.services.find(
        (s: { id: string }) => s.id === 'prism-medication-prescribe'
      );

      expect(medicationService).toBeDefined();
      expect(medicationService.hook).toBe('medication-prescribe');
      expect(medicationService.title).toBeDefined();
      expect(medicationService.description).toBeDefined();
    });

    it('should include prefetch templates for all services', async () => {
      const response = await request(app).get('/cds-services');

      for (const service of response.body.services) {
        expect(service.prefetch).toBeDefined();
        expect(typeof service.prefetch).toBe('object');
        expect(Object.keys(service.prefetch).length).toBeGreaterThan(0);
      }
    });

    it('should have valid prefetch URLs for patient-view', async () => {
      const response = await request(app).get('/cds-services');

      const patientViewService = response.body.services.find(
        (s: { id: string }) => s.id === 'prism-patient-view'
      );

      expect(patientViewService.prefetch.patient).toContain('Patient/');
      expect(patientViewService.prefetch.conditions).toContain('Condition');
    });

    it('should have valid prefetch URLs for order-review', async () => {
      const response = await request(app).get('/cds-services');

      const orderReviewService = response.body.services.find(
        (s: { id: string }) => s.id === 'prism-order-review'
      );

      expect(orderReviewService.prefetch.patient).toContain('Patient/');
      expect(orderReviewService.prefetch.medications).toContain('MedicationRequest');
    });

    it('should have valid prefetch URLs for medication-prescribe', async () => {
      const response = await request(app).get('/cds-services');

      const medicationService = response.body.services.find(
        (s: { id: string }) => s.id === 'prism-medication-prescribe'
      );

      expect(medicationService.prefetch.patient).toContain('Patient/');
      expect(medicationService.prefetch.allergies).toContain('AllergyIntolerance');
      expect(medicationService.prefetch.medications).toContain('MedicationRequest');
    });

    it('should return proper content-type header', async () => {
      const response = await request(app).get('/cds-services');

      expect(response.headers['content-type']).toContain('application/json');
    });

    it('should return services with unique IDs', async () => {
      const response = await request(app).get('/cds-services');

      const ids = response.body.services.map((s: { id: string }) => s.id);
      const uniqueIds = [...new Set(ids)];

      expect(ids.length).toBe(uniqueIds.length);
    });

    it('should match CDS Hooks 2.0 specification structure', async () => {
      const response = await request(app).get('/cds-services');

      // Top level must have services array
      expect(response.body).toHaveProperty('services');

      // Each service must have required fields
      for (const service of response.body.services) {
        expect(service).toHaveProperty('id');
        expect(service).toHaveProperty('hook');
        expect(service).toHaveProperty('title');
        expect(service).toHaveProperty('description');

        // Hook must be a valid hook type
        expect(['patient-view', 'order-review', 'medication-prescribe']).toContain(
          service.hook
        );
      }
    });
  });

  describe('Service ordering and consistency', () => {
    it('should return same services on multiple requests', async () => {
      const response1 = await request(app).get('/cds-services');
      const response2 = await request(app).get('/cds-services');

      expect(response1.body.services.length).toBe(response2.body.services.length);

      const ids1 = response1.body.services.map((s: { id: string }) => s.id).sort();
      const ids2 = response2.body.services.map((s: { id: string }) => s.id).sort();

      expect(ids1).toEqual(ids2);
    });

    it('should have exactly 3 services registered', async () => {
      const response = await request(app).get('/cds-services');

      expect(response.body.services.length).toBe(3);
    });
  });
});
