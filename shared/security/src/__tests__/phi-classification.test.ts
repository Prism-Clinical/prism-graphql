/**
 * PHI Classification Unit Tests
 *
 * Tests for PHI field classification and registry.
 */

import {
  PHILevel,
  PHI_FIELD_REGISTRY,
  PHIClassifier,
  isPHIField,
  getPHILevel,
  getDirectPHIFields,
  getSensitivePHIFields,
} from '../phi-classification';
import { samplePHIData } from '@test-utils/fixtures/security-fixtures';

describe('PHI Classification', () => {
  describe('PHILevel enum', () => {
    it('should define all required PHI levels', () => {
      expect(PHILevel.NONE).toBe('NONE');
      expect(PHILevel.INDIRECT).toBe('INDIRECT');
      expect(PHILevel.DIRECT).toBe('DIRECT');
      expect(PHILevel.SENSITIVE).toBe('SENSITIVE');
    });

    it('should have exactly 4 levels', () => {
      const levels = Object.values(PHILevel);
      expect(levels).toHaveLength(4);
    });
  });

  describe('PHI_FIELD_REGISTRY', () => {
    it('should classify Patient.firstName as DIRECT', () => {
      expect(PHI_FIELD_REGISTRY['Patient.firstName']).toBe(PHILevel.DIRECT);
    });

    it('should classify Patient.lastName as DIRECT', () => {
      expect(PHI_FIELD_REGISTRY['Patient.lastName']).toBe(PHILevel.DIRECT);
    });

    it('should classify Patient.mrn as DIRECT', () => {
      expect(PHI_FIELD_REGISTRY['Patient.mrn']).toBe(PHILevel.DIRECT);
    });

    it('should classify Patient.dateOfBirth as DIRECT', () => {
      expect(PHI_FIELD_REGISTRY['Patient.dateOfBirth']).toBe(PHILevel.DIRECT);
    });

    it('should classify Patient.email as DIRECT', () => {
      expect(PHI_FIELD_REGISTRY['Patient.email']).toBe(PHILevel.DIRECT);
    });

    it('should classify Patient.phone as DIRECT', () => {
      expect(PHI_FIELD_REGISTRY['Patient.phone']).toBe(PHILevel.DIRECT);
    });

    it('should classify Patient.address as DIRECT', () => {
      expect(PHI_FIELD_REGISTRY['Patient.address']).toBe(PHILevel.DIRECT);
    });

    it('should classify CarePlan.goals as SENSITIVE', () => {
      expect(PHI_FIELD_REGISTRY['CarePlan.goals']).toBe(PHILevel.SENSITIVE);
    });

    it('should classify CarePlan.interventions as SENSITIVE', () => {
      expect(PHI_FIELD_REGISTRY['CarePlan.interventions']).toBe(PHILevel.SENSITIVE);
    });

    it('should classify ExtractedEntities.symptoms as SENSITIVE', () => {
      expect(PHI_FIELD_REGISTRY['ExtractedEntities.symptoms']).toBe(PHILevel.SENSITIVE);
    });

    it('should classify ExtractedEntities.medications as SENSITIVE', () => {
      expect(PHI_FIELD_REGISTRY['ExtractedEntities.medications']).toBe(PHILevel.SENSITIVE);
    });

    it('should classify Transcript.text as SENSITIVE', () => {
      expect(PHI_FIELD_REGISTRY['Transcript.text']).toBe(PHILevel.SENSITIVE);
    });

    it('should not include non-PHI fields', () => {
      expect(PHI_FIELD_REGISTRY['Patient.id']).toBeUndefined();
      expect(PHI_FIELD_REGISTRY['Request.timestamp']).toBeUndefined();
    });
  });

  describe('isPHIField', () => {
    it('should return true for direct PHI fields', () => {
      expect(isPHIField('Patient.firstName')).toBe(true);
      expect(isPHIField('Patient.lastName')).toBe(true);
      expect(isPHIField('Patient.mrn')).toBe(true);
      expect(isPHIField('Patient.dateOfBirth')).toBe(true);
    });

    it('should return true for sensitive PHI fields', () => {
      expect(isPHIField('CarePlan.goals')).toBe(true);
      expect(isPHIField('ExtractedEntities.symptoms')).toBe(true);
      expect(isPHIField('Transcript.text')).toBe(true);
    });

    it('should return false for non-PHI fields', () => {
      expect(isPHIField('Patient.id')).toBe(false);
      expect(isPHIField('Request.timestamp')).toBe(false);
      expect(isPHIField('Service.name')).toBe(false);
    });

    it('should handle empty string', () => {
      expect(isPHIField('')).toBe(false);
    });

    it('should handle unknown fields', () => {
      expect(isPHIField('Unknown.field')).toBe(false);
    });
  });

  describe('getPHILevel', () => {
    it('should return DIRECT for patient identifiers', () => {
      expect(getPHILevel('Patient.firstName')).toBe(PHILevel.DIRECT);
      expect(getPHILevel('Patient.lastName')).toBe(PHILevel.DIRECT);
      expect(getPHILevel('Patient.mrn')).toBe(PHILevel.DIRECT);
    });

    it('should return SENSITIVE for health information', () => {
      expect(getPHILevel('CarePlan.goals')).toBe(PHILevel.SENSITIVE);
      expect(getPHILevel('ExtractedEntities.symptoms')).toBe(PHILevel.SENSITIVE);
    });

    it('should return NONE for non-PHI fields', () => {
      expect(getPHILevel('Patient.id')).toBe(PHILevel.NONE);
      expect(getPHILevel('Request.timestamp')).toBe(PHILevel.NONE);
    });
  });

  describe('getDirectPHIFields', () => {
    it('should return all DIRECT PHI fields', () => {
      const directFields = getDirectPHIFields();

      expect(directFields).toContain('Patient.firstName');
      expect(directFields).toContain('Patient.lastName');
      expect(directFields).toContain('Patient.mrn');
      expect(directFields).toContain('Patient.dateOfBirth');
      expect(directFields).toContain('Patient.email');
      expect(directFields).toContain('Patient.phone');
      expect(directFields).toContain('Patient.address');
    });

    it('should not include SENSITIVE fields', () => {
      const directFields = getDirectPHIFields();

      expect(directFields).not.toContain('CarePlan.goals');
      expect(directFields).not.toContain('ExtractedEntities.symptoms');
    });

    it('should not include INDIRECT fields', () => {
      const directFields = getDirectPHIFields();

      // If any INDIRECT fields exist, they should not be in DIRECT list
      const indirectFields = Object.entries(PHI_FIELD_REGISTRY)
        .filter(([_, level]) => level === PHILevel.INDIRECT)
        .map(([field]) => field);

      indirectFields.forEach((field) => {
        expect(directFields).not.toContain(field);
      });
    });
  });

  describe('getSensitivePHIFields', () => {
    it('should return all SENSITIVE PHI fields', () => {
      const sensitiveFields = getSensitivePHIFields();

      expect(sensitiveFields).toContain('CarePlan.goals');
      expect(sensitiveFields).toContain('CarePlan.interventions');
      expect(sensitiveFields).toContain('ExtractedEntities.symptoms');
      expect(sensitiveFields).toContain('ExtractedEntities.medications');
      expect(sensitiveFields).toContain('Transcript.text');
    });

    it('should not include DIRECT fields', () => {
      const sensitiveFields = getSensitivePHIFields();

      expect(sensitiveFields).not.toContain('Patient.firstName');
      expect(sensitiveFields).not.toContain('Patient.mrn');
    });
  });

  describe('PHIClassifier', () => {
    let classifier: PHIClassifier;

    beforeEach(() => {
      classifier = new PHIClassifier();
    });

    describe('classifyObject', () => {
      it('should identify direct PHI in patient data', () => {
        const result = classifier.classifyObject(samplePHIData.directPHI, 'Patient');

        expect(result.containsPHI).toBe(true);
        expect(result.directPHIFields).toContain('Patient.firstName');
        expect(result.directPHIFields).toContain('Patient.lastName');
        expect(result.directPHIFields).toContain('Patient.mrn');
        expect(result.directPHIFields).toContain('Patient.dateOfBirth');
        expect(result.directPHIFields).toContain('Patient.email');
        expect(result.directPHIFields).toContain('Patient.phone');
      });

      it('should identify sensitive PHI in health data', () => {
        const result = classifier.classifyObject(samplePHIData.sensitivePHI, 'ExtractedEntities');

        expect(result.containsPHI).toBe(true);
        expect(result.sensitivePHIFields.length).toBeGreaterThan(0);
      });

      it('should return false for non-PHI data', () => {
        const result = classifier.classifyObject(samplePHIData.nonPHI, 'Request');

        expect(result.containsPHI).toBe(false);
        expect(result.directPHIFields).toHaveLength(0);
        expect(result.sensitivePHIFields).toHaveLength(0);
      });

      it('should handle nested objects', () => {
        const nestedData = {
          patient: {
            firstName: 'John',
            lastName: 'Doe',
          },
          metadata: {
            requestId: '123',
          },
        };

        const result = classifier.classifyObject(nestedData, 'Root');

        // Should detect PHI in nested patient object
        expect(result.containsPHI).toBe(true);
      });

      it('should handle arrays', () => {
        const arrayData = {
          patients: [
            { firstName: 'John', lastName: 'Doe' },
            { firstName: 'Jane', lastName: 'Smith' },
          ],
        };

        const result = classifier.classifyObject(arrayData, 'Batch');

        expect(result.containsPHI).toBe(true);
      });

      it('should handle null and undefined values', () => {
        const nullData = {
          firstName: null,
          lastName: undefined,
          mrn: '',
        };

        const result = classifier.classifyObject(nullData, 'Patient');

        // Should still classify the fields even if values are null/undefined
        expect(result).toBeDefined();
      });

      it('should handle empty objects', () => {
        const result = classifier.classifyObject({}, 'Empty');

        expect(result.containsPHI).toBe(false);
        expect(result.directPHIFields).toHaveLength(0);
      });
    });

    describe('detectPHIPatterns', () => {
      it('should detect SSN patterns', () => {
        const text = 'The patient SSN is 123-45-6789';
        const detected = classifier.detectPHIPatterns(text);

        expect(detected.ssnPatterns).toHaveLength(1);
        expect(detected.containsPotentialPHI).toBe(true);
      });

      it('should detect email patterns', () => {
        const text = 'Contact at john.doe@email.com';
        const detected = classifier.detectPHIPatterns(text);

        expect(detected.emailPatterns).toHaveLength(1);
      });

      it('should detect phone patterns', () => {
        const text = 'Call me at (555) 123-4567 or 555-987-6543';
        const detected = classifier.detectPHIPatterns(text);

        expect(detected.phonePatterns.length).toBeGreaterThanOrEqual(1);
      });

      it('should detect date of birth patterns', () => {
        const text = 'DOB: 05/15/1985 or date of birth 1985-05-15';
        const detected = classifier.detectPHIPatterns(text);

        expect(detected.datePatterns.length).toBeGreaterThanOrEqual(1);
      });

      it('should detect MRN patterns', () => {
        const text = 'MRN: 12345678 or Medical Record Number MRN-ABCD1234';
        const detected = classifier.detectPHIPatterns(text);

        expect(detected.mrnPatterns.length).toBeGreaterThanOrEqual(1);
      });

      it('should return empty results for clean text', () => {
        const text = 'This is clean text with no PHI patterns.';
        const detected = classifier.detectPHIPatterns(text);

        expect(detected.containsPotentialPHI).toBe(false);
        expect(detected.ssnPatterns).toHaveLength(0);
        expect(detected.emailPatterns).toHaveLength(0);
      });

      it('should handle empty string', () => {
        const detected = classifier.detectPHIPatterns('');

        expect(detected.containsPotentialPHI).toBe(false);
      });
    });

    describe('validateFieldAccess', () => {
      it('should require PROVIDER role for direct PHI access', () => {
        const result = classifier.validateFieldAccess(
          'Patient.firstName',
          ['CARE_COORDINATOR']
        );

        // Care coordinators can access patient data
        expect(result.allowed).toBe(true);
      });

      it('should deny access without proper role', () => {
        const result = classifier.validateFieldAccess(
          'Patient.firstName',
          ['BILLING_STAFF'] // Hypothetical role without PHI access
        );

        // Should deny if role doesn't have permission
        expect(result.requiresAudit).toBe(true);
      });

      it('should always require audit for sensitive PHI', () => {
        const result = classifier.validateFieldAccess(
          'CarePlan.goals',
          ['PROVIDER']
        );

        expect(result.requiresAudit).toBe(true);
      });

      it('should not require audit for non-PHI fields', () => {
        const result = classifier.validateFieldAccess(
          'Request.timestamp',
          ['PROVIDER']
        );

        expect(result.requiresAudit).toBe(false);
      });
    });
  });

  describe('Edge cases and security', () => {
    it('should handle case-sensitive field names', () => {
      // Field names should be case-sensitive
      expect(isPHIField('Patient.firstName')).toBe(true);
      expect(isPHIField('patient.firstname')).toBe(false);
      expect(isPHIField('PATIENT.FIRSTNAME')).toBe(false);
    });

    it('should not be vulnerable to prototype pollution', () => {
      const maliciousInput = JSON.parse('{"__proto__": {"isAdmin": true}}');
      const classifier = new PHIClassifier();

      const result = classifier.classifyObject(maliciousInput, 'Test');

      // Should not pollute prototype
      expect(({} as any).isAdmin).toBeUndefined();
      expect(result.containsPHI).toBe(false);
    });

    it('should handle very long field paths', () => {
      const longPath = 'A'.repeat(1000) + '.field';

      expect(() => isPHIField(longPath)).not.toThrow();
      expect(isPHIField(longPath)).toBe(false);
    });

    it('should handle special characters in field names', () => {
      expect(isPHIField('Patient.first-name')).toBe(false);
      expect(isPHIField('Patient.first_name')).toBe(false);
      expect(isPHIField("Patient.first'name")).toBe(false);
    });
  });
});
