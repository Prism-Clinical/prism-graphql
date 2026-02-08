import {
  SuggestionBuilder,
  ActionBuilder,
  SuggestionValidationError,
  createSuggestionBuilder,
  createActionBuilder,
  createDeleteSuggestion,
  createCreateSuggestion,
  createUpdateSuggestion,
} from '../builders/suggestion';
import type { CDSSuggestion, CDSAction } from '../types';

describe('ActionBuilder', () => {
  describe('create action', () => {
    it('should create a valid create action', () => {
      const action = new ActionBuilder()
        .create(
          { resourceType: 'ServiceRequest', status: 'draft' },
          'Create lab order'
        )
        .build();

      expect(action.type).toBe('create');
      expect(action.description).toBe('Create lab order');
      expect(action.resource).toEqual({ resourceType: 'ServiceRequest', status: 'draft' });
    });

    it('should throw error if resource is missing', () => {
      const builder = new ActionBuilder();
      (builder as any).type = 'create';
      (builder as any).description = 'Test';

      expect(() => builder.build()).toThrow(SuggestionValidationError);
    });

    it('should throw error if resourceType is missing', () => {
      expect(() => {
        new ActionBuilder()
          .create({ status: 'draft' } as any, 'Test')
          .build();
      }).toThrow(SuggestionValidationError);
    });
  });

  describe('update action', () => {
    it('should create a valid update action', () => {
      const action = new ActionBuilder()
        .update(
          { resourceType: 'MedicationRequest', id: 'med-1', status: 'active' },
          'Update medication status'
        )
        .build();

      expect(action.type).toBe('update');
      expect(action.description).toBe('Update medication status');
      expect(action.resource).toHaveProperty('id', 'med-1');
    });
  });

  describe('delete action', () => {
    it('should create a valid delete action', () => {
      const action = new ActionBuilder()
        .delete('med-123', 'Remove medication order')
        .build();

      expect(action.type).toBe('delete');
      expect(action.description).toBe('Remove medication order');
      expect(action.resourceId).toBe('med-123');
      expect(action.resource).toBeUndefined();
    });

    it('should throw error if resourceId is empty', () => {
      expect(() => {
        new ActionBuilder().delete('', 'Test').build();
      }).toThrow(SuggestionValidationError);
    });
  });

  describe('validation', () => {
    it('should throw error if type is missing', () => {
      const builder = new ActionBuilder();
      expect(() => builder.build()).toThrow(SuggestionValidationError);
    });

    it('should throw error if description is missing', () => {
      expect(() => {
        new ActionBuilder()
          .delete('id-1', '')
          .build();
      }).toThrow(SuggestionValidationError);
    });
  });
});

describe('SuggestionBuilder', () => {
  describe('Basic suggestion creation', () => {
    it('should create a valid suggestion with required fields', () => {
      const suggestion = new SuggestionBuilder()
        .withLabel('Accept recommendation')
        .build();

      expect(suggestion.label).toBe('Accept recommendation');
      expect(suggestion.uuid).toBeDefined();
    });

    it('should auto-generate UUID if not provided', () => {
      const suggestion = new SuggestionBuilder()
        .withLabel('Test')
        .build();

      expect(suggestion.uuid).toBeDefined();
      expect(typeof suggestion.uuid).toBe('string');
      expect(suggestion.uuid?.length).toBe(36);
    });

    it('should use provided UUID', () => {
      const customUuid = '12345678-1234-4123-a123-123456789abc';
      const suggestion = new SuggestionBuilder()
        .withLabel('Test')
        .withUuid(customUuid)
        .build();

      expect(suggestion.uuid).toBe(customUuid);
    });
  });

  describe('isRecommended', () => {
    it('should set isRecommended flag', () => {
      const suggestion = new SuggestionBuilder()
        .withLabel('Recommended option')
        .asRecommended()
        .build();

      expect(suggestion.isRecommended).toBe(true);
    });

    it('should not include isRecommended if not set', () => {
      const suggestion = new SuggestionBuilder()
        .withLabel('Regular option')
        .build();

      expect(suggestion.isRecommended).toBeUndefined();
    });
  });

  describe('Adding actions', () => {
    it('should add a single action', () => {
      const action: CDSAction = {
        type: 'create',
        description: 'Create order',
        resource: { resourceType: 'ServiceRequest' },
      };

      const suggestion = new SuggestionBuilder()
        .withLabel('Add order')
        .addAction(action)
        .build();

      expect(suggestion.actions).toHaveLength(1);
      expect(suggestion.actions?.[0]?.type).toBe('create');
    });

    it('should add multiple actions', () => {
      const suggestion = new SuggestionBuilder()
        .withLabel('Multiple actions')
        .addCreateAction({ resourceType: 'ServiceRequest' }, 'Create order')
        .addDeleteAction('old-order-1', 'Remove old order')
        .build();

      expect(suggestion.actions).toHaveLength(2);
    });

    it('should add create action', () => {
      const suggestion = new SuggestionBuilder()
        .withLabel('Add lab')
        .addCreateAction(
          { resourceType: 'ServiceRequest', code: { text: 'CBC' } },
          'Order CBC'
        )
        .build();

      expect(suggestion.actions?.[0]?.type).toBe('create');
      expect(suggestion.actions?.[0]?.resource).toHaveProperty('resourceType', 'ServiceRequest');
    });

    it('should add update action', () => {
      const suggestion = new SuggestionBuilder()
        .withLabel('Update order')
        .addUpdateAction(
          { resourceType: 'MedicationRequest', id: 'med-1', status: 'cancelled' },
          'Cancel medication'
        )
        .build();

      expect(suggestion.actions?.[0]?.type).toBe('update');
    });

    it('should add delete action', () => {
      const suggestion = new SuggestionBuilder()
        .withLabel('Remove order')
        .addDeleteAction('order-123', 'Delete problematic order')
        .build();

      expect(suggestion.actions?.[0]?.type).toBe('delete');
      expect(suggestion.actions?.[0]?.resourceId).toBe('order-123');
    });

    it('should not include actions array when empty', () => {
      const suggestion = new SuggestionBuilder()
        .withLabel('No actions')
        .build();

      expect(suggestion.actions).toBeUndefined();
    });
  });

  describe('Validation', () => {
    it('should throw error when label is missing', () => {
      expect(() => {
        new SuggestionBuilder().build();
      }).toThrow(SuggestionValidationError);
    });

    it('should throw error when label is empty', () => {
      expect(() => {
        new SuggestionBuilder().withLabel('').build();
      }).toThrow(SuggestionValidationError);
    });

    it('should throw error for invalid UUID format', () => {
      expect(() => {
        new SuggestionBuilder()
          .withLabel('Test')
          .withUuid('invalid-uuid')
          .build();
      }).toThrow(SuggestionValidationError);
    });

    it('should accept valid UUID format', () => {
      const suggestion = new SuggestionBuilder()
        .withLabel('Test')
        .withUuid('12345678-1234-4123-a123-123456789abc')
        .build();

      expect(suggestion.uuid).toBe('12345678-1234-4123-a123-123456789abc');
    });
  });

  describe('tryBuild', () => {
    it('should return suggestion when valid', () => {
      const result = new SuggestionBuilder()
        .withLabel('Valid suggestion')
        .tryBuild();

      expect(result.suggestion).not.toBeNull();
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors when invalid', () => {
      const result = new SuggestionBuilder().tryBuild();

      expect(result.suggestion).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Fluent interface', () => {
    it('should support method chaining', () => {
      const suggestion = new SuggestionBuilder()
        .withLabel('Chained suggestion')
        .withUuid('12345678-1234-4123-a123-123456789abc')
        .asRecommended()
        .addCreateAction({ resourceType: 'ServiceRequest' }, 'Create')
        .addDeleteAction('old-1', 'Delete old')
        .build();

      expect(suggestion.label).toBe('Chained suggestion');
      expect(suggestion.isRecommended).toBe(true);
      expect(suggestion.actions).toHaveLength(2);
    });
  });
});

describe('createSuggestionBuilder', () => {
  it('should create a new SuggestionBuilder instance', () => {
    const builder = createSuggestionBuilder();
    expect(builder).toBeInstanceOf(SuggestionBuilder);
  });
});

describe('createActionBuilder', () => {
  it('should create a new ActionBuilder instance', () => {
    const builder = createActionBuilder();
    expect(builder).toBeInstanceOf(ActionBuilder);
  });
});

describe('createDeleteSuggestion', () => {
  it('should create a delete suggestion', () => {
    const suggestion = createDeleteSuggestion(
      'Remove order',
      'order-123',
      'Delete this order'
    );

    expect(suggestion.label).toBe('Remove order');
    expect(suggestion.actions).toHaveLength(1);
    expect(suggestion.actions?.[0]?.type).toBe('delete');
    expect(suggestion.actions?.[0]?.resourceId).toBe('order-123');
  });
});

describe('createCreateSuggestion', () => {
  it('should create a create suggestion', () => {
    const suggestion = createCreateSuggestion(
      'Add lab order',
      { resourceType: 'ServiceRequest', code: { text: 'CBC' } },
      'Order CBC'
    );

    expect(suggestion.label).toBe('Add lab order');
    expect(suggestion.actions).toHaveLength(1);
    expect(suggestion.actions?.[0]?.type).toBe('create');
    expect(suggestion.actions?.[0]?.resource).toHaveProperty('resourceType', 'ServiceRequest');
  });
});

describe('createUpdateSuggestion', () => {
  it('should create an update suggestion', () => {
    const suggestion = createUpdateSuggestion(
      'Update status',
      { resourceType: 'MedicationRequest', id: 'med-1', status: 'cancelled' },
      'Cancel medication'
    );

    expect(suggestion.label).toBe('Update status');
    expect(suggestion.actions).toHaveLength(1);
    expect(suggestion.actions?.[0]?.type).toBe('update');
  });
});

describe('SuggestionValidationError', () => {
  it('should be an instance of Error', () => {
    const error = new SuggestionValidationError('Test error');
    expect(error).toBeInstanceOf(Error);
  });

  it('should have correct name', () => {
    const error = new SuggestionValidationError('Test error');
    expect(error.name).toBe('SuggestionValidationError');
  });

  it('should have correct message', () => {
    const error = new SuggestionValidationError('Test error');
    expect(error.message).toBe('Test error');
  });
});
