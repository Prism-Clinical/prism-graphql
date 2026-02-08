import type { CDSCard, CDSHookResponse, CDSIndicator, CDSSystemAction } from '../types';

/**
 * Configuration options for ResponseAssembler
 */
export interface ResponseAssemblerOptions {
  /**
   * Maximum number of cards to include in response
   * Default: 10
   */
  maxCards?: number;

  /**
   * Whether to sort cards by severity (critical > warning > info)
   * Default: true
   */
  sortBySeverity?: boolean;

  /**
   * Whether to deduplicate cards with identical summaries
   * Default: false
   */
  deduplicateBySummary?: boolean;
}

const DEFAULT_OPTIONS: Required<ResponseAssemblerOptions> = {
  maxCards: 10,
  sortBySeverity: true,
  deduplicateBySummary: false,
};

/**
 * Indicator severity order for sorting
 */
const INDICATOR_ORDER: Record<CDSIndicator, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * ResponseAssembler - Assembles CDS Hooks responses from cards
 *
 * Handles card collection, sorting by severity, deduplication, and
 * limiting to prevent overwhelming the EHR UI.
 *
 * @example
 * const assembler = new ResponseAssembler()
 *   .addCard(criticalCard)
 *   .addCards(warningCards)
 *   .addCard(infoCard)
 *   .build();
 */
export class ResponseAssembler {
  private cards: CDSCard[] = [];
  private systemActions: CDSSystemAction[] = [];
  private options: Required<ResponseAssemblerOptions>;

  constructor(options?: ResponseAssemblerOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Add a single card to the response
   */
  addCard(card: CDSCard): this {
    this.cards.push(card);
    return this;
  }

  /**
   * Add multiple cards to the response
   */
  addCards(cards: CDSCard[]): this {
    this.cards.push(...cards);
    return this;
  }

  /**
   * Add cards conditionally
   */
  addCardIf(condition: boolean, card: CDSCard): this {
    if (condition) {
      this.cards.push(card);
    }
    return this;
  }

  /**
   * Add a system action to the response
   *
   * System actions are automatically applied without user interaction.
   * Use sparingly and only for safe, reversible operations.
   */
  addSystemAction(action: CDSSystemAction): this {
    this.systemActions.push(action);
    return this;
  }

  /**
   * Add multiple system actions to the response
   */
  addSystemActions(actions: CDSSystemAction[]): this {
    this.systemActions.push(...actions);
    return this;
  }

  /**
   * Set the maximum number of cards
   */
  withMaxCards(maxCards: number): this {
    this.options.maxCards = maxCards;
    return this;
  }

  /**
   * Enable or disable sorting by severity
   */
  withSortBySeverity(enabled: boolean): this {
    this.options.sortBySeverity = enabled;
    return this;
  }

  /**
   * Enable or disable deduplication by summary
   */
  withDeduplication(enabled: boolean): this {
    this.options.deduplicateBySummary = enabled;
    return this;
  }

  /**
   * Sort cards by indicator severity
   */
  private sortCards(cards: CDSCard[]): CDSCard[] {
    if (!this.options.sortBySeverity) {
      return cards;
    }

    return [...cards].sort((a, b) => {
      const orderA = INDICATOR_ORDER[a.indicator] ?? 2;
      const orderB = INDICATOR_ORDER[b.indicator] ?? 2;
      return orderA - orderB;
    });
  }

  /**
   * Deduplicate cards by summary
   */
  private deduplicateCards(cards: CDSCard[]): CDSCard[] {
    if (!this.options.deduplicateBySummary) {
      return cards;
    }

    const seen = new Set<string>();
    return cards.filter(card => {
      const key = card.summary.toLowerCase().trim();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Limit cards to maxCards
   */
  private limitCards(cards: CDSCard[]): CDSCard[] {
    return cards.slice(0, this.options.maxCards);
  }

  /**
   * Get the current card count (before processing)
   */
  getCardCount(): number {
    return this.cards.length;
  }

  /**
   * Check if the response has any cards
   */
  hasCards(): boolean {
    return this.cards.length > 0;
  }

  /**
   * Check if the response has any critical cards
   */
  hasCriticalCards(): boolean {
    return this.cards.some(card => card.indicator === 'critical');
  }

  /**
   * Check if the response has any warning cards
   */
  hasWarningCards(): boolean {
    return this.cards.some(card => card.indicator === 'warning');
  }

  /**
   * Build the CDS Hooks response
   *
   * Processes cards (sort, deduplicate, limit) and returns
   * a valid CDSHookResponse object.
   */
  build(): CDSHookResponse {
    // Process cards
    let processedCards = [...this.cards];

    // Deduplicate if enabled
    processedCards = this.deduplicateCards(processedCards);

    // Sort by severity if enabled
    processedCards = this.sortCards(processedCards);

    // Limit to maxCards
    processedCards = this.limitCards(processedCards);

    // Build response
    const response: CDSHookResponse = {
      cards: processedCards,
    };

    // Add system actions if present
    if (this.systemActions.length > 0) {
      response.systemActions = this.systemActions;
    }

    return response;
  }

  /**
   * Build an empty response with no cards
   *
   * Use when there are no recommendations or issues to report.
   */
  buildEmpty(): CDSHookResponse {
    return {
      cards: [],
    };
  }

}

/**
 * Create a new ResponseAssembler instance
 */
export function createResponseAssembler(
  options?: ResponseAssemblerOptions
): ResponseAssembler {
  return new ResponseAssembler(options);
}

/**
 * Create an empty CDS Hooks response
 */
export function createEmptyResponse(): CDSHookResponse {
  return { cards: [] };
}

/**
 * Create a response with a single card
 */
export function createSingleCardResponse(card: CDSCard): CDSHookResponse {
  return { cards: [card] };
}

/**
 * Create a response from an array of cards
 *
 * Applies default processing (sort by severity, limit to 10)
 */
export function createResponse(cards: CDSCard[]): CDSHookResponse {
  return new ResponseAssembler().addCards(cards).build();
}

/**
 * Quick helper to create a sorted and limited response
 */
export function assembleResponse(
  cards: CDSCard[],
  maxCards: number = 10
): CDSHookResponse {
  return new ResponseAssembler({ maxCards }).addCards(cards).build();
}

/**
 * Statistics about the response assembly
 */
export interface ResponseStats {
  totalCards: number;
  includedCards: number;
  excludedCards: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

/**
 * Get statistics about the cards that would be included in a response
 */
export function getResponseStats(
  cards: CDSCard[],
  maxCards: number = 10
): ResponseStats {
  const sortedCards = [...cards].sort((a, b) => {
    const orderA = INDICATOR_ORDER[a.indicator] ?? 2;
    const orderB = INDICATOR_ORDER[b.indicator] ?? 2;
    return orderA - orderB;
  });

  const includedCards = sortedCards.slice(0, maxCards);
  const excludedCards = sortedCards.length - includedCards.length;

  return {
    totalCards: cards.length,
    includedCards: includedCards.length,
    excludedCards: excludedCards,
    criticalCount: includedCards.filter(c => c.indicator === 'critical').length,
    warningCount: includedCards.filter(c => c.indicator === 'warning').length,
    infoCount: includedCards.filter(c => c.indicator === 'info').length,
  };
}
