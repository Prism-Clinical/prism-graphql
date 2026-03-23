import { Pool } from 'pg';
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

  /**
   * Load custom signal definitions from DB. If any CUSTOM_RULES signals exist,
   * the caller must have already registered a CUSTOM_RULES scorer via register().
   * This method just checks whether custom signals exist and returns the count.
   *
   * The CustomRulesScorer is registered at startup in src/index.ts alongside
   * the other built-in scorers — it does NOT need to be imported here.
   */
  async loadCustomSignals(pool: Pool, institutionId?: string): Promise<number> {
    let query = `
      SELECT COUNT(*) as count
      FROM confidence_signal_definitions
      WHERE scoring_type = 'CUSTOM_RULES' AND is_active = true
    `;
    const params: string[] = [];

    if (institutionId) {
      query += ` AND (scope = 'SYSTEM' OR (scope = 'INSTITUTION' AND institution_id = $1))`;
      params.push(institutionId);
    } else {
      query += ` AND scope = 'SYSTEM'`;
    }

    const result = await pool.query(query, params);
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }
}
