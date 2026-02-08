import request from 'supertest';
import { app } from '../index';
import { cdsServices } from '../config/services';
import type { CDSDiscoveryResponse, CDSServiceDefinition } from '../types';

describe('CDS Hooks Discovery Endpoint', () => {
  describe('GET /cds-services', () => {
    it('should return 200 status code', async () => {
      const response = await request(app).get('/cds-services');
      expect(response.status).toBe(200);
    });

    it('should return valid JSON content type', async () => {
      const response = await request(app).get('/cds-services');
      expect(response.headers['content-type']).toMatch(/application\/json/);
    });

    it('should return services array in response', async () => {
      const response = await request(app).get('/cds-services');
      const body = response.body as CDSDiscoveryResponse;
      expect(body).toHaveProperty('services');
      expect(Array.isArray(body.services)).toBe(true);
    });

    it('should include patient-view hook service', async () => {
      const response = await request(app).get('/cds-services');
      const body = response.body as CDSDiscoveryResponse;
      const patientViewService = body.services.find(s => s.hook === 'patient-view');
      expect(patientViewService).toBeDefined();
      expect(patientViewService?.id).toBe('prism-patient-view');
    });

    it('should include order-review hook service', async () => {
      const response = await request(app).get('/cds-services');
      const body = response.body as CDSDiscoveryResponse;
      const orderReviewService = body.services.find(s => s.hook === 'order-review');
      expect(orderReviewService).toBeDefined();
      expect(orderReviewService?.id).toBe('prism-order-review');
    });

    it('should include medication-prescribe hook service', async () => {
      const response = await request(app).get('/cds-services');
      const body = response.body as CDSDiscoveryResponse;
      const medPrescribeService = body.services.find(s => s.hook === 'medication-prescribe');
      expect(medPrescribeService).toBeDefined();
      expect(medPrescribeService?.id).toBe('prism-medication-prescribe');
    });

    it('should include all three required services', async () => {
      const response = await request(app).get('/cds-services');
      const body = response.body as CDSDiscoveryResponse;
      expect(body.services.length).toBe(3);
    });

    describe('service definitions', () => {
      let services: CDSServiceDefinition[];

      beforeAll(async () => {
        const response = await request(app).get('/cds-services');
        services = (response.body as CDSDiscoveryResponse).services;
      });

      it('each service should have required id field', () => {
        services.forEach(service => {
          expect(typeof service.id).toBe('string');
          expect(service.id.length).toBeGreaterThan(0);
        });
      });

      it('each service should have required hook field', () => {
        services.forEach(service => {
          expect(typeof service.hook).toBe('string');
          expect(['patient-view', 'order-review', 'medication-prescribe']).toContain(service.hook);
        });
      });

      it('each service should have required title field', () => {
        services.forEach(service => {
          expect(typeof service.title).toBe('string');
          expect(service.title.length).toBeGreaterThan(0);
        });
      });

      it('each service should have required description field', () => {
        services.forEach(service => {
          expect(typeof service.description).toBe('string');
          expect(service.description.length).toBeGreaterThan(0);
        });
      });

      it('each service should have prefetch templates', () => {
        services.forEach(service => {
          expect(service.prefetch).toBeDefined();
          expect(typeof service.prefetch).toBe('object');
        });
      });
    });

    describe('prefetch templates', () => {
      it('patient-view should include patient prefetch', async () => {
        const response = await request(app).get('/cds-services');
        const body = response.body as CDSDiscoveryResponse;
        const service = body.services.find(s => s.id === 'prism-patient-view');
        expect(service?.prefetch?.patient).toBe('Patient/{{context.patientId}}');
      });

      it('patient-view should include conditions prefetch', async () => {
        const response = await request(app).get('/cds-services');
        const body = response.body as CDSDiscoveryResponse;
        const service = body.services.find(s => s.id === 'prism-patient-view');
        expect(service?.prefetch?.conditions).toContain('Condition?patient={{context.patientId}}');
      });

      it('medication-prescribe should include allergies prefetch', async () => {
        const response = await request(app).get('/cds-services');
        const body = response.body as CDSDiscoveryResponse;
        const service = body.services.find(s => s.id === 'prism-medication-prescribe');
        expect(service?.prefetch?.allergies).toContain('AllergyIntolerance?patient={{context.patientId}}');
      });

      it('prefetch templates should use FHIR query format', async () => {
        const response = await request(app).get('/cds-services');
        const body = response.body as CDSDiscoveryResponse;

        body.services.forEach(service => {
          if (service.prefetch) {
            Object.values(service.prefetch).forEach((template: string) => {
              // Should contain context variable substitution
              expect(template).toMatch(/\{\{context\.\w+\}\}/);
            });
          }
        });
      });
    });
  });

  describe('GET /cds-services/:serviceId', () => {
    it('should return specific service by ID', async () => {
      const response = await request(app).get('/cds-services/prism-patient-view');
      expect(response.status).toBe(200);
      expect(response.body.id).toBe('prism-patient-view');
    });

    it('should return 404 for unknown service ID', async () => {
      const response = await request(app).get('/cds-services/unknown-service');
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    });

    it('should return full service definition', async () => {
      const response = await request(app).get('/cds-services/prism-order-review');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('hook');
      expect(response.body).toHaveProperty('title');
      expect(response.body).toHaveProperty('description');
      expect(response.body).toHaveProperty('prefetch');
    });
  });

  describe('CORS headers', () => {
    it('should include Access-Control-Allow-Origin header', async () => {
      const response = await request(app)
        .get('/cds-services')
        .set('Origin', 'https://ehr.example.com');

      // CORS middleware should set the header
      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });

    it('should handle OPTIONS preflight request', async () => {
      const response = await request(app)
        .options('/cds-services')
        .set('Origin', 'https://ehr.example.com')
        .set('Access-Control-Request-Method', 'GET');

      expect(response.status).toBe(204);
    });
  });

  describe('Health check', () => {
    it('should return 200 for /health endpoint', async () => {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
    });

    it('should include service name in health response', async () => {
      const response = await request(app).get('/health');
      expect(response.body.service).toBe('cds-hooks-service');
    });

    it('should include timestamp in health response', async () => {
      const response = await request(app).get('/health');
      expect(response.body.timestamp).toBeDefined();
      expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);
    });
  });

  describe('Readiness check', () => {
    it('should return valid readiness response for /ready endpoint', async () => {
      const response = await request(app).get('/ready');
      // In test environment, FHIR server is not available so may return not_ready
      expect([200, 503]).toContain(response.status);
      expect(['ready', 'not_ready']).toContain(response.body.status);
      expect(response.body.service).toBe('cds-hooks-service');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('Error handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/unknown-route');
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    });
  });
});
