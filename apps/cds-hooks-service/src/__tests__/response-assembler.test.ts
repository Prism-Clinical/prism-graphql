import {
  ResponseAssembler,
  createResponseAssembler,
  createEmptyResponse,
  createSingleCardResponse,
  createResponse,
  assembleResponse,
  getResponseStats,
} from '../assemblers/response';
import type { CDSCard, CDSHookResponse } from '../types';

// Helper to create test cards
function createTestCard(
  indicator: 'info' | 'warning' | 'critical',
  summary: string
): CDSCard {
  return {
    uuid: `uuid-${summary.replace(/\s/g, '-')}`,
    summary,
    indicator,
    source: { label: 'Test' },
  };
}

describe('ResponseAssembler', () => {
  describe('Basic card assembly', () => {
    it('should create response with single card', () => {
      const card = createTestCard('info', 'Test card');
      const response = new ResponseAssembler().addCard(card).build();

      expect(response.cards).toHaveLength(1);
      expect(response.cards[0]?.summary).toBe('Test card');
    });

    it('should create response with multiple cards', () => {
      const response = new ResponseAssembler()
        .addCard(createTestCard('info', 'Card 1'))
        .addCard(createTestCard('warning', 'Card 2'))
        .addCard(createTestCard('critical', 'Card 3'))
        .build();

      expect(response.cards).toHaveLength(3);
    });

    it('should add cards in bulk', () => {
      const cards = [
        createTestCard('info', 'Card 1'),
        createTestCard('info', 'Card 2'),
        createTestCard('info', 'Card 3'),
      ];

      const response = new ResponseAssembler().addCards(cards).build();

      expect(response.cards).toHaveLength(3);
    });

    it('should return empty cards array when no cards added', () => {
      const response = new ResponseAssembler().build();

      expect(response.cards).toEqual([]);
    });
  });

  describe('Card sorting by severity', () => {
    it('should sort cards by severity (critical > warning > info)', () => {
      const response = new ResponseAssembler()
        .addCard(createTestCard('info', 'Info card'))
        .addCard(createTestCard('critical', 'Critical card'))
        .addCard(createTestCard('warning', 'Warning card'))
        .build();

      expect(response.cards[0]?.indicator).toBe('critical');
      expect(response.cards[1]?.indicator).toBe('warning');
      expect(response.cards[2]?.indicator).toBe('info');
    });

    it('should maintain order within same severity', () => {
      const response = new ResponseAssembler()
        .addCard(createTestCard('warning', 'Warning 1'))
        .addCard(createTestCard('warning', 'Warning 2'))
        .addCard(createTestCard('warning', 'Warning 3'))
        .build();

      expect(response.cards[0]?.summary).toBe('Warning 1');
      expect(response.cards[1]?.summary).toBe('Warning 2');
      expect(response.cards[2]?.summary).toBe('Warning 3');
    });

    it('should not sort when sorting is disabled', () => {
      const response = new ResponseAssembler({ sortBySeverity: false })
        .addCard(createTestCard('info', 'Info'))
        .addCard(createTestCard('critical', 'Critical'))
        .addCard(createTestCard('warning', 'Warning'))
        .build();

      expect(response.cards[0]?.indicator).toBe('info');
      expect(response.cards[1]?.indicator).toBe('critical');
      expect(response.cards[2]?.indicator).toBe('warning');
    });

    it('should allow toggling sort with method', () => {
      const response = new ResponseAssembler()
        .withSortBySeverity(false)
        .addCard(createTestCard('info', 'Info'))
        .addCard(createTestCard('critical', 'Critical'))
        .build();

      expect(response.cards[0]?.indicator).toBe('info');
    });
  });

  describe('Card limiting', () => {
    it('should limit cards to default of 10', () => {
      const assembler = new ResponseAssembler();
      for (let i = 0; i < 15; i++) {
        assembler.addCard(createTestCard('info', `Card ${i}`));
      }

      const response = assembler.build();

      expect(response.cards).toHaveLength(10);
    });

    it('should respect custom maxCards setting', () => {
      const assembler = new ResponseAssembler({ maxCards: 5 });
      for (let i = 0; i < 10; i++) {
        assembler.addCard(createTestCard('info', `Card ${i}`));
      }

      const response = assembler.build();

      expect(response.cards).toHaveLength(5);
    });

    it('should allow setting maxCards with method', () => {
      const assembler = new ResponseAssembler().withMaxCards(3);
      for (let i = 0; i < 10; i++) {
        assembler.addCard(createTestCard('info', `Card ${i}`));
      }

      const response = assembler.build();

      expect(response.cards).toHaveLength(3);
    });

    it('should prioritize critical cards when limiting', () => {
      const assembler = new ResponseAssembler({ maxCards: 3 });
      assembler
        .addCard(createTestCard('info', 'Info 1'))
        .addCard(createTestCard('info', 'Info 2'))
        .addCard(createTestCard('critical', 'Critical'))
        .addCard(createTestCard('warning', 'Warning'))
        .addCard(createTestCard('info', 'Info 3'));

      const response = assembler.build();

      expect(response.cards).toHaveLength(3);
      expect(response.cards[0]?.indicator).toBe('critical');
      expect(response.cards[1]?.indicator).toBe('warning');
      expect(response.cards[2]?.indicator).toBe('info');
    });
  });

  describe('Card deduplication', () => {
    it('should not deduplicate by default', () => {
      const response = new ResponseAssembler()
        .addCard(createTestCard('info', 'Same summary'))
        .addCard(createTestCard('info', 'Same summary'))
        .build();

      expect(response.cards).toHaveLength(2);
    });

    it('should deduplicate when enabled', () => {
      const response = new ResponseAssembler({ deduplicateBySummary: true })
        .addCard(createTestCard('info', 'Same summary'))
        .addCard(createTestCard('info', 'Same summary'))
        .addCard(createTestCard('info', 'Different summary'))
        .build();

      expect(response.cards).toHaveLength(2);
    });

    it('should deduplicate case-insensitively', () => {
      const response = new ResponseAssembler()
        .withDeduplication(true)
        .addCard(createTestCard('info', 'Same Summary'))
        .addCard(createTestCard('info', 'same summary'))
        .build();

      expect(response.cards).toHaveLength(1);
    });
  });

  describe('System actions', () => {
    it('should not include systemActions when none added', () => {
      const response = new ResponseAssembler()
        .addCard(createTestCard('info', 'Test'))
        .build();

      expect(response.systemActions).toBeUndefined();
    });

    it('should include single system action', () => {
      const response = new ResponseAssembler()
        .addCard(createTestCard('info', 'Test'))
        .addSystemAction({
          type: 'create',
          description: 'Create resource',
        })
        .build();

      expect(response.systemActions).toHaveLength(1);
    });

    it('should include multiple system actions', () => {
      const response = new ResponseAssembler()
        .addCard(createTestCard('info', 'Test'))
        .addSystemActions([
          { type: 'create', description: 'Create' },
          { type: 'update', description: 'Update' },
        ])
        .build();

      expect(response.systemActions).toHaveLength(2);
    });
  });

  describe('Conditional card adding', () => {
    it('should add card when condition is true', () => {
      const response = new ResponseAssembler()
        .addCardIf(true, createTestCard('info', 'Included'))
        .build();

      expect(response.cards).toHaveLength(1);
    });

    it('should not add card when condition is false', () => {
      const response = new ResponseAssembler()
        .addCardIf(false, createTestCard('info', 'Excluded'))
        .build();

      expect(response.cards).toHaveLength(0);
    });
  });

  describe('Helper methods', () => {
    it('should report correct card count', () => {
      const assembler = new ResponseAssembler()
        .addCard(createTestCard('info', 'Card 1'))
        .addCard(createTestCard('info', 'Card 2'));

      expect(assembler.getCardCount()).toBe(2);
    });

    it('should report hasCards correctly', () => {
      const empty = new ResponseAssembler();
      const withCards = new ResponseAssembler().addCard(
        createTestCard('info', 'Test')
      );

      expect(empty.hasCards()).toBe(false);
      expect(withCards.hasCards()).toBe(true);
    });

    it('should report hasCriticalCards correctly', () => {
      const noCritical = new ResponseAssembler()
        .addCard(createTestCard('info', 'Info'))
        .addCard(createTestCard('warning', 'Warning'));

      const withCritical = new ResponseAssembler()
        .addCard(createTestCard('critical', 'Critical'));

      expect(noCritical.hasCriticalCards()).toBe(false);
      expect(withCritical.hasCriticalCards()).toBe(true);
    });

    it('should report hasWarningCards correctly', () => {
      const noWarning = new ResponseAssembler()
        .addCard(createTestCard('info', 'Info'));

      const withWarning = new ResponseAssembler()
        .addCard(createTestCard('warning', 'Warning'));

      expect(noWarning.hasWarningCards()).toBe(false);
      expect(withWarning.hasWarningCards()).toBe(true);
    });
  });

  describe('buildEmpty', () => {
    it('should return empty response', () => {
      const assembler = new ResponseAssembler()
        .addCard(createTestCard('info', 'Card'));

      const response = assembler.buildEmpty();

      expect(response.cards).toEqual([]);
    });
  });

  describe('reset', () => {
    it('should reset assembler state', () => {
      const assembler = new ResponseAssembler()
        .addCard(createTestCard('info', 'Card'))
        .addSystemAction({ type: 'create', description: 'Create' });

      assembler.reset();

      expect(assembler.getCardCount()).toBe(0);
      expect(assembler.build().systemActions).toBeUndefined();
    });

    it('should allow building new response after reset', () => {
      const assembler = new ResponseAssembler()
        .addCard(createTestCard('info', 'First'));

      const first = assembler.build();
      assembler.reset();

      const second = assembler
        .addCard(createTestCard('critical', 'Second'))
        .build();

      expect(first.cards[0]?.summary).toBe('First');
      expect(second.cards[0]?.summary).toBe('Second');
    });
  });
});

describe('createResponseAssembler', () => {
  it('should create a new ResponseAssembler instance', () => {
    const assembler = createResponseAssembler();
    expect(assembler).toBeInstanceOf(ResponseAssembler);
  });

  it('should accept options', () => {
    const assembler = createResponseAssembler({ maxCards: 5 });
    for (let i = 0; i < 10; i++) {
      assembler.addCard(createTestCard('info', `Card ${i}`));
    }

    expect(assembler.build().cards).toHaveLength(5);
  });
});

describe('createEmptyResponse', () => {
  it('should create an empty response', () => {
    const response = createEmptyResponse();

    expect(response.cards).toEqual([]);
    expect(response.systemActions).toBeUndefined();
  });
});

describe('createSingleCardResponse', () => {
  it('should create a response with one card', () => {
    const card = createTestCard('warning', 'Single card');
    const response = createSingleCardResponse(card);

    expect(response.cards).toHaveLength(1);
    expect(response.cards[0]?.summary).toBe('Single card');
  });
});

describe('createResponse', () => {
  it('should create a response from cards array', () => {
    const cards = [
      createTestCard('info', 'Info'),
      createTestCard('critical', 'Critical'),
    ];

    const response = createResponse(cards);

    expect(response.cards).toHaveLength(2);
    expect(response.cards[0]?.indicator).toBe('critical');
  });
});

describe('assembleResponse', () => {
  it('should assemble response with default limit', () => {
    const cards: CDSCard[] = [];
    for (let i = 0; i < 15; i++) {
      cards.push(createTestCard('info', `Card ${i}`));
    }

    const response = assembleResponse(cards);

    expect(response.cards).toHaveLength(10);
  });

  it('should assemble response with custom limit', () => {
    const cards: CDSCard[] = [];
    for (let i = 0; i < 15; i++) {
      cards.push(createTestCard('info', `Card ${i}`));
    }

    const response = assembleResponse(cards, 5);

    expect(response.cards).toHaveLength(5);
  });
});

describe('getResponseStats', () => {
  it('should calculate correct statistics', () => {
    const cards = [
      createTestCard('critical', 'Critical 1'),
      createTestCard('critical', 'Critical 2'),
      createTestCard('warning', 'Warning 1'),
      createTestCard('info', 'Info 1'),
      createTestCard('info', 'Info 2'),
    ];

    const stats = getResponseStats(cards);

    expect(stats.totalCards).toBe(5);
    expect(stats.includedCards).toBe(5);
    expect(stats.excludedCards).toBe(0);
    expect(stats.criticalCount).toBe(2);
    expect(stats.warningCount).toBe(1);
    expect(stats.infoCount).toBe(2);
  });

  it('should account for excluded cards', () => {
    const cards: CDSCard[] = [];
    for (let i = 0; i < 15; i++) {
      cards.push(createTestCard('info', `Card ${i}`));
    }

    const stats = getResponseStats(cards, 10);

    expect(stats.totalCards).toBe(15);
    expect(stats.includedCards).toBe(10);
    expect(stats.excludedCards).toBe(5);
  });

  it('should prioritize critical cards in stats', () => {
    const cards = [
      createTestCard('info', 'Info 1'),
      createTestCard('info', 'Info 2'),
      createTestCard('critical', 'Critical'),
    ];

    const stats = getResponseStats(cards, 2);

    expect(stats.includedCards).toBe(2);
    expect(stats.criticalCount).toBe(1);
    expect(stats.infoCount).toBe(1);
  });
});
