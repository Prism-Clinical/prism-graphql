import { v4 as uuidv4 } from 'uuid';
import type {
  CDSCard,
  CDSIndicator,
  CDSSource,
  CDSSuggestion,
  CDSLink,
  CDSOverrideReason,
} from '../types';

/**
 * Validation error thrown when card is invalid
 */
export class CardValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardValidationError';
  }
}

/**
 * CardBuilder - Fluent builder for CDS Hooks cards
 *
 * Creates valid CDS Hooks 2.0 specification cards with proper validation.
 * All cards require summary, indicator, and source fields.
 *
 * @example
 * const card = new CardBuilder()
 *   .withSummary('Important alert')
 *   .withIndicator('warning')
 *   .withSource({ label: 'Prism CDS' })
 *   .withDetail('More details here...')
 *   .build();
 */
export class CardBuilder {
  private uuid?: string;
  private summary?: string;
  private detail?: string;
  private indicator?: CDSIndicator;
  private source?: CDSSource;
  private suggestions?: CDSSuggestion[];
  private links?: CDSLink[];
  private overrideReasons?: CDSOverrideReason[];
  private selectionBehavior?: 'at-most-one' | 'any';

  /**
   * Set the card UUID (auto-generated if not provided)
   */
  withUuid(uuid: string): this {
    this.uuid = uuid;
    return this;
  }

  /**
   * Set the card summary (required)
   *
   * Brief text displayed in the card header. Should be a single sentence
   * summarizing the clinical recommendation or alert.
   */
  withSummary(summary: string): this {
    this.summary = summary;
    return this;
  }

  /**
   * Set the card detail (optional)
   *
   * Detailed information supporting the summary. Markdown is supported.
   * Use for rationale, evidence, and additional context.
   */
  withDetail(detail: string): this {
    this.detail = detail;
    return this;
  }

  /**
   * Set the card indicator (required)
   *
   * Visual importance indicator:
   * - 'info': Informational, no action required
   * - 'warning': Attention needed, action recommended
   * - 'critical': Urgent action required
   */
  withIndicator(indicator: CDSIndicator): this {
    this.indicator = indicator;
    return this;
  }

  /**
   * Set the card source (required)
   *
   * Attribution for the card content. Must include a label,
   * optionally with URL and icon.
   */
  withSource(source: CDSSource): this {
    this.source = source;
    return this;
  }

  /**
   * Add a single suggestion to the card
   *
   * Suggestions provide actionable options for the user.
   */
  addSuggestion(suggestion: CDSSuggestion): this {
    if (!this.suggestions) {
      this.suggestions = [];
    }
    this.suggestions.push(suggestion);
    return this;
  }

  /**
   * Set all suggestions at once
   */
  withSuggestions(suggestions: CDSSuggestion[]): this {
    this.suggestions = suggestions;
    return this;
  }

  /**
   * Add a single link to the card
   *
   * Links provide access to external resources or SMART apps.
   */
  addLink(link: CDSLink): this {
    if (!this.links) {
      this.links = [];
    }
    this.links.push(link);
    return this;
  }

  /**
   * Set all links at once
   */
  withLinks(links: CDSLink[]): this {
    this.links = links;
    return this;
  }

  /**
   * Add an override reason
   *
   * Override reasons allow clinicians to dismiss the card with
   * a documented justification.
   */
  addOverrideReason(reason: CDSOverrideReason): this {
    if (!this.overrideReasons) {
      this.overrideReasons = [];
    }
    this.overrideReasons.push(reason);
    return this;
  }

  /**
   * Set all override reasons at once
   */
  withOverrideReasons(reasons: CDSOverrideReason[]): this {
    this.overrideReasons = reasons;
    return this;
  }

  /**
   * Set the selection behavior for suggestions
   *
   * - 'at-most-one': Only one suggestion can be selected
   * - 'any': Multiple suggestions can be selected
   */
  withSelectionBehavior(behavior: 'at-most-one' | 'any'): this {
    this.selectionBehavior = behavior;
    return this;
  }

  /**
   * Validate the card before building
   *
   * @throws CardValidationError if required fields are missing or invalid
   */
  private validate(): void {
    const errors: string[] = [];

    // Required fields
    if (!this.summary || this.summary.trim() === '') {
      errors.push('summary is required and cannot be empty');
    }

    if (!this.indicator) {
      errors.push('indicator is required');
    } else if (!['info', 'warning', 'critical'].includes(this.indicator)) {
      errors.push(`indicator must be 'info', 'warning', or 'critical', got '${this.indicator}'`);
    }

    if (!this.source) {
      errors.push('source is required');
    } else if (!this.source.label || this.source.label.trim() === '') {
      errors.push('source.label is required and cannot be empty');
    }

    // UUID format validation (if provided)
    if (this.uuid) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(this.uuid)) {
        errors.push('uuid must be a valid UUID format');
      }
    }

    // Selection behavior validation
    if (this.selectionBehavior && !['at-most-one', 'any'].includes(this.selectionBehavior)) {
      errors.push(`selectionBehavior must be 'at-most-one' or 'any'`);
    }

    // Link type validation
    if (this.links) {
      for (let i = 0; i < this.links.length; i++) {
        const link = this.links[i];
        if (!link) continue;

        if (!link.label || link.label.trim() === '') {
          errors.push(`links[${i}].label is required`);
        }
        if (!link.url || link.url.trim() === '') {
          errors.push(`links[${i}].url is required`);
        }
        if (!link.type || !['absolute', 'smart'].includes(link.type)) {
          errors.push(`links[${i}].type must be 'absolute' or 'smart'`);
        }
      }
    }

    // Suggestion validation
    if (this.suggestions) {
      for (let i = 0; i < this.suggestions.length; i++) {
        const suggestion = this.suggestions[i];
        if (!suggestion) continue;

        if (!suggestion.label || suggestion.label.trim() === '') {
          errors.push(`suggestions[${i}].label is required`);
        }
      }
    }

    if (errors.length > 0) {
      throw new CardValidationError(`Card validation failed: ${errors.join('; ')}`);
    }
  }

  /**
   * Build the card
   *
   * Validates all fields and returns a valid CDSCard object.
   * Automatically generates a UUID if not provided.
   *
   * @throws CardValidationError if validation fails
   */
  build(): CDSCard {
    this.validate();

    const card: CDSCard = {
      uuid: this.uuid || uuidv4(),
      summary: this.summary!,
      indicator: this.indicator!,
      source: this.source!,
    };

    if (this.detail) {
      card.detail = this.detail;
    }

    if (this.suggestions && this.suggestions.length > 0) {
      card.suggestions = this.suggestions;
    }

    if (this.links && this.links.length > 0) {
      card.links = this.links;
    }

    if (this.overrideReasons && this.overrideReasons.length > 0) {
      card.overrideReasons = this.overrideReasons;
    }

    if (this.selectionBehavior) {
      card.selectionBehavior = this.selectionBehavior;
    }

    return card;
  }

  /**
   * Build the card without throwing on validation errors
   *
   * Returns the card if valid, or null with errors if invalid.
   */
  tryBuild(): { card: CDSCard | null; errors: string[] } {
    try {
      const card = this.build();
      return { card, errors: [] };
    } catch (error) {
      if (error instanceof CardValidationError) {
        return { card: null, errors: [error.message] };
      }
      throw error;
    }
  }

  /**
   * Reset the builder to initial state
   */
  reset(): this {
    this.uuid = undefined;
    this.summary = undefined;
    this.detail = undefined;
    this.indicator = undefined;
    this.source = undefined;
    this.suggestions = undefined;
    this.links = undefined;
    this.overrideReasons = undefined;
    this.selectionBehavior = undefined;
    return this;
  }
}

/**
 * Create a new CardBuilder instance
 *
 * Convenience function for creating cards.
 */
export function createCardBuilder(): CardBuilder {
  return new CardBuilder();
}

/**
 * Create an info card quickly
 */
export function createInfoCard(
  summary: string,
  sourceLabel: string,
  detail?: string
): CDSCard {
  const builder = new CardBuilder()
    .withSummary(summary)
    .withIndicator('info')
    .withSource({ label: sourceLabel });

  if (detail) {
    builder.withDetail(detail);
  }

  return builder.build();
}

/**
 * Create a warning card quickly
 */
export function createWarningCard(
  summary: string,
  sourceLabel: string,
  detail?: string
): CDSCard {
  const builder = new CardBuilder()
    .withSummary(summary)
    .withIndicator('warning')
    .withSource({ label: sourceLabel });

  if (detail) {
    builder.withDetail(detail);
  }

  return builder.build();
}

/**
 * Create a critical card quickly
 */
export function createCriticalCard(
  summary: string,
  sourceLabel: string,
  detail?: string
): CDSCard {
  const builder = new CardBuilder()
    .withSummary(summary)
    .withIndicator('critical')
    .withSource({ label: sourceLabel });

  if (detail) {
    builder.withDetail(detail);
  }

  return builder.build();
}
