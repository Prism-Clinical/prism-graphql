import { ScoringType, SignalScorer } from './types';

export class ScorerRegistry {
  private scorers: Map<ScoringType, SignalScorer> = new Map();

  register(scorer: SignalScorer): void {
    this.scorers.set(scorer.scoringType, scorer);
  }

  get(scoringType: ScoringType): SignalScorer | undefined {
    return this.scorers.get(scoringType);
  }

  has(scoringType: ScoringType): boolean {
    return this.scorers.has(scoringType);
  }
}
