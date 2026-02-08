import request from 'supertest';
import express, { Express } from 'express';
import { validateCDSRequest, validateServiceId, zodErrorHandler } from '../middleware/validation';
import { v4 as uuidv4 } from 'uuid';

/**
 * Create a test app with validation middleware
 */
function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  // Test route for validation middleware
  app.post('/cds-services/:serviceId', validateCDSRequest, (req, res) => {
    res.status(200).json({
      success: true,
      validatedRequest: res.locals.validatedRequest,
    });
  });

  // Test route for service ID validation
  app.get('/cds-services/:serviceId', validateServiceId, (req, res) => {
    res.status(200).json({ serviceId: req.params.serviceId });
  });

  app.use(zodErrorHandler);

  return app;
}

describe('CDS Hooks Request Validation Middleware', () => {
  let app: Express;

  beforeEach(() => {
    app = createTestApp();
  });

  describe('hookInstance validation', () => {
    it('should accept valid UUID v4 hookInstance', async () => {
      const validRequest = {
        hookInstance: uuidv4(),
        hook: 'patient-view',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject invalid UUID format', async () => {
      const invalidRequest = {
        hookInstance: 'not-a-valid-uuid',
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
      expect(response.body.error).toBe('invalid_request');
      expect(response.body.validationErrors).toBeDefined();
      expect(response.body.validationErrors[0].field).toBe('hookInstance');
    });

    it('should reject missing hookInstance', async () => {
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
      expect(response.body.error).toBe('invalid_request');
    });

    it('should reject UUID v1 format (not v4)', async () => {
      // UUID v1 format (time-based, has 1 in the version position)
      const invalidRequest = {
        hookInstance: '550e8400-e29b-11d4-a716-446655440000',
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
      expect(response.body.validationErrors[0].field).toBe('hookInstance');
    });
  });

  describe('hook type validation', () => {
    it('should accept patient-view hook', async () => {
      const validRequest = {
        hookInstance: uuidv4(),
        hook: 'patient-view',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      expect(response.status).toBe(200);
    });

    it('should accept order-review hook', async () => {
      const validRequest = {
        hookInstance: uuidv4(),
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
        .send(validRequest);

      expect(response.status).toBe(200);
    });

    it('should accept medication-prescribe hook', async () => {
      const validRequest = {
        hookInstance: uuidv4(),
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
        .send(validRequest);

      expect(response.status).toBe(200);
    });

    it('should reject unsupported hook type', async () => {
      const invalidRequest = {
        hookInstance: uuidv4(),
        hook: 'unsupported-hook',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(invalidRequest);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('invalid_request');
    });

    it('should reject missing hook field', async () => {
      const invalidRequest = {
        hookInstance: uuidv4(),
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
  });

  describe('context validation', () => {
    it('should accept valid patient-view context', async () => {
      const validRequest = {
        hookInstance: uuidv4(),
        hook: 'patient-view',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          encounterId: 'Encounter/789', // optional
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      expect(response.status).toBe(200);
    });

    it('should reject missing userId in context', async () => {
      const invalidRequest = {
        hookInstance: uuidv4(),
        hook: 'patient-view',
        context: {
          patientId: 'Patient/456',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(invalidRequest);

      expect(response.status).toBe(400);
      expect(response.body.validationErrors).toBeDefined();
      const userIdError = response.body.validationErrors.find(
        (e: { field: string }) => e.field === 'context.userId'
      );
      expect(userIdError).toBeDefined();
    });

    it('should reject missing patientId in context', async () => {
      const invalidRequest = {
        hookInstance: uuidv4(),
        hook: 'patient-view',
        context: {
          userId: 'Practitioner/123',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(invalidRequest);

      expect(response.status).toBe(400);
      const patientIdError = response.body.validationErrors.find(
        (e: { field: string }) => e.field === 'context.patientId'
      );
      expect(patientIdError).toBeDefined();
    });

    it('should reject empty userId', async () => {
      const invalidRequest = {
        hookInstance: uuidv4(),
        hook: 'patient-view',
        context: {
          userId: '',
          patientId: 'Patient/456',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });

    it('should reject missing context entirely', async () => {
      const invalidRequest = {
        hookInstance: uuidv4(),
        hook: 'patient-view',
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });
  });

  describe('order-review specific context', () => {
    it('should require draftOrders for order-review hook', async () => {
      const invalidRequest = {
        hookInstance: uuidv4(),
        hook: 'order-review',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          // Missing draftOrders
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(invalidRequest);

      expect(response.status).toBe(400);
      const draftOrdersError = response.body.validationErrors.find(
        (e: { field: string }) => e.field === 'context.draftOrders'
      );
      expect(draftOrdersError).toBeDefined();
    });

    it('should validate draftOrders is a Bundle', async () => {
      const invalidRequest = {
        hookInstance: uuidv4(),
        hook: 'order-review',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          draftOrders: {
            resourceType: 'Patient', // Wrong type
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-order-review')
        .send(invalidRequest);

      expect(response.status).toBe(400);
    });
  });

  describe('medication-prescribe specific context', () => {
    it('should require medications for medication-prescribe hook', async () => {
      const invalidRequest = {
        hookInstance: uuidv4(),
        hook: 'medication-prescribe',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
          // Missing medications
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-medication-prescribe')
        .send(invalidRequest);

      expect(response.status).toBe(400);
      const medsError = response.body.validationErrors.find(
        (e: { field: string }) => e.field === 'context.medications'
      );
      expect(medsError).toBeDefined();
    });
  });

  describe('optional fields', () => {
    it('should accept fhirServer if valid URL', async () => {
      const validRequest = {
        hookInstance: uuidv4(),
        hook: 'patient-view',
        fhirServer: 'https://fhir.example.com/r4',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      expect(response.status).toBe(200);
    });

    it('should reject invalid fhirServer URL', async () => {
      const invalidRequest = {
        hookInstance: uuidv4(),
        hook: 'patient-view',
        fhirServer: 'not-a-valid-url',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(invalidRequest);

      expect(response.status).toBe(400);
      const fhirServerError = response.body.validationErrors.find(
        (e: { field: string }) => e.field === 'fhirServer'
      );
      expect(fhirServerError).toBeDefined();
    });

    it('should accept fhirAuthorization if complete', async () => {
      const validRequest = {
        hookInstance: uuidv4(),
        hook: 'patient-view',
        fhirAuthorization: {
          access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'patient/*.read',
          subject: 'Patient/456',
        },
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      expect(response.status).toBe(200);
    });

    it('should accept prefetch data', async () => {
      const validRequest = {
        hookInstance: uuidv4(),
        hook: 'patient-view',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
        },
        prefetch: {
          patient: {
            resourceType: 'Patient',
            id: '456',
          },
        },
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(validRequest);

      expect(response.status).toBe(200);
    });
  });

  describe('service ID validation', () => {
    it('should return 404 for unknown service ID on POST', async () => {
      const validRequest = {
        hookInstance: uuidv4(),
        hook: 'patient-view',
        context: {
          userId: 'Practitioner/123',
          patientId: 'Patient/456',
        },
      };

      const response = await request(app)
        .post('/cds-services/unknown-service')
        .send(validRequest);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    });

    it('should return 404 for unknown service ID on GET', async () => {
      const response = await request(app)
        .get('/cds-services/unknown-service');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('not_found');
    });

    it('should accept known service ID', async () => {
      const response = await request(app)
        .get('/cds-services/prism-patient-view');

      expect(response.status).toBe(200);
    });
  });

  describe('error response format', () => {
    it('should return validationErrors array with field, message, code', async () => {
      const invalidRequest = {
        hookInstance: 'invalid',
        hook: 'patient-view',
        context: {},
      };

      const response = await request(app)
        .post('/cds-services/prism-patient-view')
        .send(invalidRequest);

      expect(response.status).toBe(400);
      expect(response.body.validationErrors).toBeDefined();
      expect(Array.isArray(response.body.validationErrors)).toBe(true);

      const firstError = response.body.validationErrors[0];
      expect(firstError).toHaveProperty('field');
      expect(firstError).toHaveProperty('message');
      expect(firstError).toHaveProperty('code');
    });
  });
});
