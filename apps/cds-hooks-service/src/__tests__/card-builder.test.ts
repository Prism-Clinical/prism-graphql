import {
  CardBuilder,
  CardValidationError,
  createCardBuilder,
  createInfoCard,
  createWarningCard,
  createCriticalCard,
} from '../builders/card';
import type { CDSCard, CDSSuggestion, CDSLink } from '../types';

describe('CardBuilder', () => {
  describe('Basic card creation', () => {
    it('should create a valid card with required fields', () => {
      const card = new CardBuilder()
        .withSummary('Test summary')
        .withIndicator('info')
        .withSource({ label: 'Test Source' })
        .build();

      expect(card.summary).toBe('Test summary');
      expect(card.indicator).toBe('info');
      expect(card.source.label).toBe('Test Source');
      expect(card.uuid).toBeDefined();
    });

    it('should auto-generate UUID if not provided', () => {
      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .build();

      expect(card.uuid).toBeDefined();
      expect(typeof card.uuid).toBe('string');
      expect(card.uuid?.length).toBe(36); // UUID length
    });

    it('should use provided UUID', () => {
      const customUuid = '12345678-1234-4123-a123-123456789abc';
      const card = new CardBuilder()
        .withUuid(customUuid)
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .build();

      expect(card.uuid).toBe(customUuid);
    });

    it('should include detail when provided', () => {
      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .withDetail('Detailed information')
        .build();

      expect(card.detail).toBe('Detailed information');
    });

    it('should not include detail when not provided', () => {
      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .build();

      expect(card.detail).toBeUndefined();
    });
  });

  describe('Indicator values', () => {
    it('should accept "info" indicator', () => {
      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .build();

      expect(card.indicator).toBe('info');
    });

    it('should accept "warning" indicator', () => {
      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('warning')
        .withSource({ label: 'Source' })
        .build();

      expect(card.indicator).toBe('warning');
    });

    it('should accept "critical" indicator', () => {
      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('critical')
        .withSource({ label: 'Source' })
        .build();

      expect(card.indicator).toBe('critical');
    });
  });

  describe('Suggestions', () => {
    it('should add a single suggestion', () => {
      const suggestion: CDSSuggestion = {
        label: 'Apply suggestion',
        actions: [{ type: 'create', description: 'Create resource' }],
      };

      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .addSuggestion(suggestion)
        .build();

      expect(card.suggestions).toHaveLength(1);
      expect(card.suggestions?.[0]?.label).toBe('Apply suggestion');
    });

    it('should add multiple suggestions', () => {
      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .addSuggestion({ label: 'Option 1' })
        .addSuggestion({ label: 'Option 2' })
        .build();

      expect(card.suggestions).toHaveLength(2);
    });

    it('should set all suggestions at once', () => {
      const suggestions: CDSSuggestion[] = [
        { label: 'Option A' },
        { label: 'Option B' },
        { label: 'Option C' },
      ];

      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .withSuggestions(suggestions)
        .build();

      expect(card.suggestions).toHaveLength(3);
    });

    it('should not include suggestions when not provided', () => {
      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .build();

      expect(card.suggestions).toBeUndefined();
    });
  });

  describe('Links', () => {
    it('should add a single link', () => {
      const link: CDSLink = {
        label: 'More info',
        url: 'https://example.com',
        type: 'absolute',
      };

      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .addLink(link)
        .build();

      expect(card.links).toHaveLength(1);
      expect(card.links?.[0]?.label).toBe('More info');
    });

    it('should add multiple links', () => {
      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .addLink({ label: 'Link 1', url: 'https://example1.com', type: 'absolute' })
        .addLink({ label: 'Link 2', url: 'https://example2.com', type: 'smart' })
        .build();

      expect(card.links).toHaveLength(2);
    });

    it('should set all links at once', () => {
      const links: CDSLink[] = [
        { label: 'Doc', url: 'https://docs.example.com', type: 'absolute' },
        { label: 'App', url: 'https://app.example.com', type: 'smart' },
      ];

      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .withLinks(links)
        .build();

      expect(card.links).toHaveLength(2);
    });

    it('should support SMART links with appContext', () => {
      const link: CDSLink = {
        label: 'Open App',
        url: 'https://smartapp.example.com/launch',
        type: 'smart',
        appContext: 'patient=123',
      };

      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .addLink(link)
        .build();

      expect(card.links?.[0]?.appContext).toBe('patient=123');
    });
  });

  describe('Override reasons', () => {
    it('should add override reasons', () => {
      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('warning')
        .withSource({ label: 'Source' })
        .addOverrideReason({ display: 'Already discussed with patient' })
        .addOverrideReason({ display: 'Will address at follow-up' })
        .build();

      expect(card.overrideReasons).toHaveLength(2);
    });

    it('should set all override reasons at once', () => {
      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('warning')
        .withSource({ label: 'Source' })
        .withOverrideReasons([
          { display: 'Reason 1' },
          { display: 'Reason 2' },
        ])
        .build();

      expect(card.overrideReasons).toHaveLength(2);
    });
  });

  describe('Selection behavior', () => {
    it('should set at-most-one selection behavior', () => {
      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .addSuggestion({ label: 'Option 1' })
        .addSuggestion({ label: 'Option 2' })
        .withSelectionBehavior('at-most-one')
        .build();

      expect(card.selectionBehavior).toBe('at-most-one');
    });

    it('should set any selection behavior', () => {
      const card = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .addSuggestion({ label: 'Option 1' })
        .addSuggestion({ label: 'Option 2' })
        .withSelectionBehavior('any')
        .build();

      expect(card.selectionBehavior).toBe('any');
    });
  });

  describe('Validation', () => {
    it('should throw error when summary is missing', () => {
      expect(() => {
        new CardBuilder()
          .withIndicator('info')
          .withSource({ label: 'Source' })
          .build();
      }).toThrow(CardValidationError);
    });

    it('should throw error when summary is empty', () => {
      expect(() => {
        new CardBuilder()
          .withSummary('')
          .withIndicator('info')
          .withSource({ label: 'Source' })
          .build();
      }).toThrow(CardValidationError);
    });

    it('should throw error when indicator is missing', () => {
      expect(() => {
        new CardBuilder()
          .withSummary('Test')
          .withSource({ label: 'Source' })
          .build();
      }).toThrow(CardValidationError);
    });

    it('should throw error when source is missing', () => {
      expect(() => {
        new CardBuilder()
          .withSummary('Test')
          .withIndicator('info')
          .build();
      }).toThrow(CardValidationError);
    });

    it('should throw error when source label is empty', () => {
      expect(() => {
        new CardBuilder()
          .withSummary('Test')
          .withIndicator('info')
          .withSource({ label: '' })
          .build();
      }).toThrow(CardValidationError);
    });

    it('should throw error for invalid UUID format', () => {
      expect(() => {
        new CardBuilder()
          .withUuid('invalid-uuid')
          .withSummary('Test')
          .withIndicator('info')
          .withSource({ label: 'Source' })
          .build();
      }).toThrow(CardValidationError);
    });

    it('should throw error for link with empty label', () => {
      expect(() => {
        new CardBuilder()
          .withSummary('Test')
          .withIndicator('info')
          .withSource({ label: 'Source' })
          .addLink({ label: '', url: 'https://example.com', type: 'absolute' })
          .build();
      }).toThrow(CardValidationError);
    });

    it('should throw error for link with empty URL', () => {
      expect(() => {
        new CardBuilder()
          .withSummary('Test')
          .withIndicator('info')
          .withSource({ label: 'Source' })
          .addLink({ label: 'Link', url: '', type: 'absolute' })
          .build();
      }).toThrow(CardValidationError);
    });

    it('should throw error for suggestion with empty label', () => {
      expect(() => {
        new CardBuilder()
          .withSummary('Test')
          .withIndicator('info')
          .withSource({ label: 'Source' })
          .addSuggestion({ label: '' })
          .build();
      }).toThrow(CardValidationError);
    });
  });

  describe('tryBuild', () => {
    it('should return card when valid', () => {
      const result = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' })
        .tryBuild();

      expect(result.card).not.toBeNull();
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors when invalid', () => {
      const result = new CardBuilder()
        .withIndicator('info')
        .tryBuild();

      expect(result.card).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    it('should reset builder to initial state', () => {
      const builder = new CardBuilder()
        .withSummary('Test')
        .withIndicator('info')
        .withSource({ label: 'Source' });

      builder.reset();

      expect(() => builder.build()).toThrow(CardValidationError);
    });

    it('should allow building new card after reset', () => {
      const builder = new CardBuilder()
        .withSummary('First card')
        .withIndicator('info')
        .withSource({ label: 'Source' });

      const firstCard = builder.build();
      builder.reset();

      const secondCard = builder
        .withSummary('Second card')
        .withIndicator('warning')
        .withSource({ label: 'Source 2' })
        .build();

      expect(firstCard.summary).toBe('First card');
      expect(secondCard.summary).toBe('Second card');
    });
  });

  describe('Fluent interface', () => {
    it('should support method chaining', () => {
      const card = new CardBuilder()
        .withUuid('12345678-1234-4123-a123-123456789abc')
        .withSummary('Chained card')
        .withDetail('Detail')
        .withIndicator('warning')
        .withSource({ label: 'Source', url: 'https://example.com' })
        .addSuggestion({ label: 'Suggestion' })
        .addLink({ label: 'Link', url: 'https://link.com', type: 'absolute' })
        .addOverrideReason({ display: 'Override' })
        .withSelectionBehavior('at-most-one')
        .build();

      expect(card.summary).toBe('Chained card');
      expect(card.detail).toBe('Detail');
      expect(card.indicator).toBe('warning');
      expect(card.suggestions).toHaveLength(1);
      expect(card.links).toHaveLength(1);
      expect(card.overrideReasons).toHaveLength(1);
      expect(card.selectionBehavior).toBe('at-most-one');
    });
  });
});

describe('createCardBuilder', () => {
  it('should create a new CardBuilder instance', () => {
    const builder = createCardBuilder();
    expect(builder).toBeInstanceOf(CardBuilder);
  });
});

describe('createInfoCard', () => {
  it('should create an info card', () => {
    const card = createInfoCard('Info message', 'Source');

    expect(card.summary).toBe('Info message');
    expect(card.indicator).toBe('info');
    expect(card.source.label).toBe('Source');
  });

  it('should include detail when provided', () => {
    const card = createInfoCard('Info message', 'Source', 'Detail text');

    expect(card.detail).toBe('Detail text');
  });
});

describe('createWarningCard', () => {
  it('should create a warning card', () => {
    const card = createWarningCard('Warning message', 'Source');

    expect(card.summary).toBe('Warning message');
    expect(card.indicator).toBe('warning');
    expect(card.source.label).toBe('Source');
  });

  it('should include detail when provided', () => {
    const card = createWarningCard('Warning message', 'Source', 'Detail text');

    expect(card.detail).toBe('Detail text');
  });
});

describe('createCriticalCard', () => {
  it('should create a critical card', () => {
    const card = createCriticalCard('Critical message', 'Source');

    expect(card.summary).toBe('Critical message');
    expect(card.indicator).toBe('critical');
    expect(card.source.label).toBe('Source');
  });

  it('should include detail when provided', () => {
    const card = createCriticalCard('Critical message', 'Source', 'Detail text');

    expect(card.detail).toBe('Detail text');
  });
});

describe('CardValidationError', () => {
  it('should be an instance of Error', () => {
    const error = new CardValidationError('Test error');
    expect(error).toBeInstanceOf(Error);
  });

  it('should have correct name', () => {
    const error = new CardValidationError('Test error');
    expect(error.name).toBe('CardValidationError');
  });

  it('should have correct message', () => {
    const error = new CardValidationError('Test error');
    expect(error.message).toBe('Test error');
  });
});
