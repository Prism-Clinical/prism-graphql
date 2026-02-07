import {
  LinkBuilder,
  LinkValidationError,
  createLinkBuilder,
  createAbsoluteLink,
  createSmartLink,
  createDocumentationLink,
  createGuidelineLink,
} from '../builders/link';
import type { CDSLink } from '../types';

describe('LinkBuilder', () => {
  describe('Absolute links', () => {
    it('should create a valid absolute link', () => {
      const link = new LinkBuilder()
        .withLabel('View Documentation')
        .withUrl('https://docs.example.com/guidelines')
        .asAbsolute()
        .build();

      expect(link.label).toBe('View Documentation');
      expect(link.url).toBe('https://docs.example.com/guidelines');
      expect(link.type).toBe('absolute');
    });

    it('should not include appContext for absolute links', () => {
      const link = new LinkBuilder()
        .withLabel('External Link')
        .withUrl('https://example.com')
        .asAbsolute()
        .build();

      expect(link.appContext).toBeUndefined();
    });
  });

  describe('SMART links', () => {
    it('should create a valid SMART link', () => {
      const link = new LinkBuilder()
        .withLabel('Open App')
        .withUrl('https://smartapp.example.com/launch')
        .asSmart()
        .build();

      expect(link.label).toBe('Open App');
      expect(link.url).toBe('https://smartapp.example.com/launch');
      expect(link.type).toBe('smart');
    });

    it('should include appContext for SMART links', () => {
      const link = new LinkBuilder()
        .withLabel('Open Care Plan')
        .withUrl('https://smartapp.example.com/careplan')
        .asSmart()
        .withAppContext('patient=123&encounter=456')
        .build();

      expect(link.appContext).toBe('patient=123&encounter=456');
    });

    it('should not include appContext when not provided', () => {
      const link = new LinkBuilder()
        .withLabel('Open App')
        .withUrl('https://smartapp.example.com')
        .asSmart()
        .build();

      expect(link.appContext).toBeUndefined();
    });
  });

  describe('withType', () => {
    it('should set type using withType method', () => {
      const link = new LinkBuilder()
        .withLabel('Link')
        .withUrl('https://example.com')
        .withType('absolute')
        .build();

      expect(link.type).toBe('absolute');
    });

    it('should work with smart type', () => {
      const link = new LinkBuilder()
        .withLabel('Link')
        .withUrl('https://example.com')
        .withType('smart')
        .build();

      expect(link.type).toBe('smart');
    });
  });

  describe('Validation', () => {
    it('should throw error when label is missing', () => {
      expect(() => {
        new LinkBuilder()
          .withUrl('https://example.com')
          .asAbsolute()
          .build();
      }).toThrow(LinkValidationError);
    });

    it('should throw error when label is empty', () => {
      expect(() => {
        new LinkBuilder()
          .withLabel('')
          .withUrl('https://example.com')
          .asAbsolute()
          .build();
      }).toThrow(LinkValidationError);
    });

    it('should throw error when url is missing', () => {
      expect(() => {
        new LinkBuilder()
          .withLabel('Link')
          .asAbsolute()
          .build();
      }).toThrow(LinkValidationError);
    });

    it('should throw error when url is empty', () => {
      expect(() => {
        new LinkBuilder()
          .withLabel('Link')
          .withUrl('')
          .asAbsolute()
          .build();
      }).toThrow(LinkValidationError);
    });

    it('should throw error when url is invalid', () => {
      expect(() => {
        new LinkBuilder()
          .withLabel('Link')
          .withUrl('not-a-valid-url')
          .asAbsolute()
          .build();
      }).toThrow(LinkValidationError);
    });

    it('should throw error when type is missing', () => {
      expect(() => {
        new LinkBuilder()
          .withLabel('Link')
          .withUrl('https://example.com')
          .build();
      }).toThrow(LinkValidationError);
    });

    it('should throw error when appContext is used with absolute type', () => {
      expect(() => {
        new LinkBuilder()
          .withLabel('Link')
          .withUrl('https://example.com')
          .asAbsolute()
          .withAppContext('patient=123')
          .build();
      }).toThrow(LinkValidationError);
    });

    it('should accept valid URLs with paths', () => {
      const link = new LinkBuilder()
        .withLabel('Link')
        .withUrl('https://example.com/path/to/resource')
        .asAbsolute()
        .build();

      expect(link.url).toBe('https://example.com/path/to/resource');
    });

    it('should accept valid URLs with query parameters', () => {
      const link = new LinkBuilder()
        .withLabel('Link')
        .withUrl('https://example.com/path?param=value')
        .asAbsolute()
        .build();

      expect(link.url).toBe('https://example.com/path?param=value');
    });
  });

  describe('tryBuild', () => {
    it('should return link when valid', () => {
      const result = new LinkBuilder()
        .withLabel('Link')
        .withUrl('https://example.com')
        .asAbsolute()
        .tryBuild();

      expect(result.link).not.toBeNull();
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors when invalid', () => {
      const result = new LinkBuilder()
        .withLabel('Link')
        .tryBuild();

      expect(result.link).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    it('should reset builder to initial state', () => {
      const builder = new LinkBuilder()
        .withLabel('Link')
        .withUrl('https://example.com')
        .asAbsolute();

      builder.reset();

      expect(() => builder.build()).toThrow(LinkValidationError);
    });

    it('should allow building new link after reset', () => {
      const builder = new LinkBuilder()
        .withLabel('First')
        .withUrl('https://first.com')
        .asAbsolute();

      const first = builder.build();
      builder.reset();

      const second = builder
        .withLabel('Second')
        .withUrl('https://second.com')
        .asSmart()
        .build();

      expect(first.label).toBe('First');
      expect(first.type).toBe('absolute');
      expect(second.label).toBe('Second');
      expect(second.type).toBe('smart');
    });
  });

  describe('Fluent interface', () => {
    it('should support method chaining', () => {
      const link = new LinkBuilder()
        .withLabel('Chained Link')
        .withUrl('https://smartapp.example.com/launch')
        .asSmart()
        .withAppContext('patient=123&careplan=456')
        .build();

      expect(link.label).toBe('Chained Link');
      expect(link.type).toBe('smart');
      expect(link.appContext).toBe('patient=123&careplan=456');
    });
  });
});

describe('createLinkBuilder', () => {
  it('should create a new LinkBuilder instance', () => {
    const builder = createLinkBuilder();
    expect(builder).toBeInstanceOf(LinkBuilder);
  });
});

describe('createAbsoluteLink', () => {
  it('should create an absolute link', () => {
    const link = createAbsoluteLink('View Docs', 'https://docs.example.com');

    expect(link.label).toBe('View Docs');
    expect(link.url).toBe('https://docs.example.com');
    expect(link.type).toBe('absolute');
  });
});

describe('createSmartLink', () => {
  it('should create a SMART link without appContext', () => {
    const link = createSmartLink('Open App', 'https://smartapp.example.com');

    expect(link.label).toBe('Open App');
    expect(link.url).toBe('https://smartapp.example.com');
    expect(link.type).toBe('smart');
    expect(link.appContext).toBeUndefined();
  });

  it('should create a SMART link with appContext', () => {
    const link = createSmartLink(
      'Open App',
      'https://smartapp.example.com',
      'patient=123'
    );

    expect(link.appContext).toBe('patient=123');
  });
});

describe('createDocumentationLink', () => {
  it('should create a documentation link', () => {
    const link = createDocumentationLink(
      'API Documentation',
      'https://docs.example.com/api'
    );

    expect(link.label).toBe('API Documentation');
    expect(link.type).toBe('absolute');
  });
});

describe('createGuidelineLink', () => {
  it('should create a guideline link with formatted label', () => {
    const link = createGuidelineLink(
      'ADA Diabetes',
      'https://diabetes.org/guidelines'
    );

    expect(link.label).toBe('View ADA Diabetes Guidelines');
    expect(link.url).toBe('https://diabetes.org/guidelines');
    expect(link.type).toBe('absolute');
  });
});

describe('LinkValidationError', () => {
  it('should be an instance of Error', () => {
    const error = new LinkValidationError('Test error');
    expect(error).toBeInstanceOf(Error);
  });

  it('should have correct name', () => {
    const error = new LinkValidationError('Test error');
    expect(error.name).toBe('LinkValidationError');
  });

  it('should have correct message', () => {
    const error = new LinkValidationError('Test error');
    expect(error.message).toBe('Test error');
  });
});
