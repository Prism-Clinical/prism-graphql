import { v4 as uuidv4 } from 'uuid';
import type { CDSSuggestion, CDSAction } from '../types';

/**
 * Validation error thrown when suggestion is invalid
 */
export class SuggestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SuggestionValidationError';
  }
}

/**
 * FHIR resource types commonly used in suggestions
 */
export interface FHIRResourceBase {
  resourceType: string;
  id?: string;
  [key: string]: unknown;
}

/**
 * Action types supported by CDS Hooks
 */
export type ActionType = 'create' | 'update' | 'delete';

/**
 * ActionBuilder - Builder for individual CDS Hooks actions
 *
 * Actions are operations that modify EHR state when a suggestion is accepted.
 */
export class ActionBuilder {
  private type?: ActionType;
  private description?: string;
  private resource?: FHIRResourceBase;
  private resourceId?: string;

  /**
   * Set action type to 'create' with a FHIR resource
   *
   * Use this when suggesting new resources to be created (e.g., new orders).
   */
  create(resource: FHIRResourceBase, description: string): this {
    this.type = 'create';
    this.resource = resource;
    this.description = description;
    return this;
  }

  /**
   * Set action type to 'update' with a modified FHIR resource
   *
   * Use this when suggesting modifications to existing resources.
   */
  update(resource: FHIRResourceBase, description: string): this {
    this.type = 'update';
    this.resource = resource;
    this.description = description;
    return this;
  }

  /**
   * Set action type to 'delete' with a resource ID
   *
   * Use this when suggesting removal of existing resources.
   */
  delete(resourceId: string, description: string): this {
    this.type = 'delete';
    this.resourceId = resourceId;
    this.description = description;
    return this;
  }

  /**
   * Validate the action before building
   */
  private validate(): void {
    const errors: string[] = [];

    if (!this.type) {
      errors.push('action type is required');
    }

    if (!this.description || this.description.trim() === '') {
      errors.push('description is required');
    }

    if (this.type === 'create' || this.type === 'update') {
      if (!this.resource) {
        errors.push(`resource is required for ${this.type} action`);
      } else if (!this.resource.resourceType) {
        errors.push('resource.resourceType is required');
      }
    }

    if (this.type === 'delete') {
      if (!this.resourceId || this.resourceId.trim() === '') {
        errors.push('resourceId is required for delete action');
      }
    }

    if (errors.length > 0) {
      throw new SuggestionValidationError(`Action validation failed: ${errors.join('; ')}`);
    }
  }

  /**
   * Build the action
   */
  build(): CDSAction {
    this.validate();

    const action: CDSAction = {
      type: this.type!,
      description: this.description!,
    };

    if (this.type === 'create' || this.type === 'update') {
      action.resource = this.resource;
    }

    if (this.type === 'delete') {
      action.resourceId = this.resourceId;
    }

    return action;
  }
}

/**
 * SuggestionBuilder - Fluent builder for CDS Hooks suggestions
 *
 * Suggestions provide actionable options that users can accept to modify EHR state.
 * Each suggestion has a label, optional UUID, and one or more actions.
 *
 * @example
 * const suggestion = new SuggestionBuilder()
 *   .withLabel('Add lab order')
 *   .addCreateAction({
 *     resourceType: 'ServiceRequest',
 *     status: 'draft',
 *     code: { text: 'CBC' }
 *   }, 'Create CBC lab order')
 *   .build();
 */
export class SuggestionBuilder {
  private label?: string;
  private uuid?: string;
  private isRecommended?: boolean;
  private actions: CDSAction[] = [];

  /**
   * Set the suggestion label (required)
   *
   * Human-readable text describing what this suggestion does.
   */
  withLabel(label: string): this {
    this.label = label;
    return this;
  }

  /**
   * Set the suggestion UUID (auto-generated if not provided)
   */
  withUuid(uuid: string): this {
    this.uuid = uuid;
    return this;
  }

  /**
   * Mark this suggestion as the recommended option
   */
  asRecommended(): this {
    this.isRecommended = true;
    return this;
  }

  /**
   * Add a pre-built action
   */
  addAction(action: CDSAction): this {
    this.actions.push(action);
    return this;
  }

  /**
   * Add a create action with FHIR resource
   *
   * Use this when suggesting new resources to be created.
   */
  addCreateAction(resource: FHIRResourceBase, description: string): this {
    const action = new ActionBuilder().create(resource, description).build();
    this.actions.push(action);
    return this;
  }

  /**
   * Add an update action with FHIR resource
   *
   * Use this when suggesting modifications to existing resources.
   */
  addUpdateAction(resource: FHIRResourceBase, description: string): this {
    const action = new ActionBuilder().update(resource, description).build();
    this.actions.push(action);
    return this;
  }

  /**
   * Add a delete action with resource ID
   *
   * Use this when suggesting removal of existing resources.
   */
  addDeleteAction(resourceId: string, description: string): this {
    const action = new ActionBuilder().delete(resourceId, description).build();
    this.actions.push(action);
    return this;
  }

  /**
   * Validate the suggestion before building
   */
  private validate(): void {
    const errors: string[] = [];

    if (!this.label || this.label.trim() === '') {
      errors.push('label is required');
    }

    // UUID format validation (if provided)
    if (this.uuid) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(this.uuid)) {
        errors.push('uuid must be a valid UUID format');
      }
    }

    if (errors.length > 0) {
      throw new SuggestionValidationError(`Suggestion validation failed: ${errors.join('; ')}`);
    }
  }

  /**
   * Build the suggestion
   *
   * Validates and returns a valid CDSSuggestion object.
   */
  build(): CDSSuggestion {
    this.validate();

    const suggestion: CDSSuggestion = {
      label: this.label!,
      uuid: this.uuid || uuidv4(),
    };

    if (this.isRecommended) {
      suggestion.isRecommended = true;
    }

    if (this.actions.length > 0) {
      suggestion.actions = this.actions;
    }

    return suggestion;
  }

  /**
   * Build the suggestion without throwing on validation errors
   */
  tryBuild(): { suggestion: CDSSuggestion | null; errors: string[] } {
    try {
      const suggestion = this.build();
      return { suggestion, errors: [] };
    } catch (error) {
      if (error instanceof SuggestionValidationError) {
        return { suggestion: null, errors: [error.message] };
      }
      throw error;
    }
  }

  /**
   * Reset the builder to initial state
   */
  reset(): this {
    this.label = undefined;
    this.uuid = undefined;
    this.isRecommended = undefined;
    this.actions = [];
    return this;
  }
}

/**
 * Create a new SuggestionBuilder instance
 */
export function createSuggestionBuilder(): SuggestionBuilder {
  return new SuggestionBuilder();
}

/**
 * Create a new ActionBuilder instance
 */
export function createActionBuilder(): ActionBuilder {
  return new ActionBuilder();
}

/**
 * Quick helper to create a delete suggestion
 */
export function createDeleteSuggestion(
  label: string,
  resourceId: string,
  description: string
): CDSSuggestion {
  return new SuggestionBuilder()
    .withLabel(label)
    .addDeleteAction(resourceId, description)
    .build();
}

/**
 * Quick helper to create a create suggestion
 */
export function createCreateSuggestion(
  label: string,
  resource: FHIRResourceBase,
  description: string
): CDSSuggestion {
  return new SuggestionBuilder()
    .withLabel(label)
    .addCreateAction(resource, description)
    .build();
}

/**
 * Quick helper to create an update suggestion
 */
export function createUpdateSuggestion(
  label: string,
  resource: FHIRResourceBase,
  description: string
): CDSSuggestion {
  return new SuggestionBuilder()
    .withLabel(label)
    .addUpdateAction(resource, description)
    .build();
}
