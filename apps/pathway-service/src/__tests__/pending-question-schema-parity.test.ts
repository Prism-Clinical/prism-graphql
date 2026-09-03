/**
 * The two pending-question types describe the same thing and must not drift.
 *
 * `PendingQuestionType` (single-pathway sessions) and
 * `MultiPathwayPendingGate` (the merged flow) are populated from the same
 * `PendingQuestion` objects by the same engine. They drifted anyway:
 * `datumKey` and `optionLabels` were added to the multi-pathway type only, so
 * the single-pathway resolvers RETURNED both fields and GraphQL silently
 * dropped them — a client asking a per-pathway session could not tell a datum
 * request from a clinical question, or render a branch title.
 *
 * Silently is the operative word. Returning a field the schema does not
 * declare is not an error anywhere; it just vanishes. Nothing but a test like
 * this notices.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA = readFileSync(join(__dirname, '../../schema.graphql'), 'utf-8');

/** Field names of one SDL type, ignoring descriptions and directives. */
function fieldsOf(typeName: string): Set<string> {
  const m = SCHEMA.match(new RegExp(`\\ntype ${typeName} \\{([\\s\\S]*?)\\n\\}`));
  if (!m) throw new Error(`type ${typeName} not found in schema.graphql`);
  const body = m[1]
    // Strip block descriptions, which can otherwise contain colons.
    .replace(/"""[\s\S]*?"""/g, '');
  const names = new Set<string>();
  for (const line of body.split('\n')) {
    const f = line.trim().match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
    if (f) names.add(f[1]);
  }
  return names;
}

/**
 * Fields that describe the QUESTION. Both types must carry all of them.
 *
 * Deliberately not "every field": `MultiPathwayPendingGate` also carries
 * routing identity — which session and pathway a gate belongs to — that a
 * single-pathway question does not need, because its session is the context.
 */
const QUESTION_FIELDS = [
  'gateId',
  'prompt',
  'answerType',
  'options',
  'optionLabels',
  'affectedSubtreeSize',
  'estimatedImpact',
  'tentative',
  'tentativeBranch',
  'tentativeConfidence',
  'tentativeReasoning',
  'datumKey',
];

describe('pending-question schema parity', () => {
  const single = fieldsOf('PendingQuestionType');
  const multi = fieldsOf('MultiPathwayPendingGate');

  it.each(QUESTION_FIELDS)('PendingQuestionType declares %s', (field) => {
    expect(single.has(field)).toBe(true);
  });

  it.each(QUESTION_FIELDS)('MultiPathwayPendingGate declares %s', (field) => {
    expect(multi.has(field)).toBe(true);
  });

  /**
   * The multi-pathway type may carry MORE (session/pathway identity), but a
   * field describing the question itself must exist on both. This is what
   * would have caught the original drift.
   */
  it('has no question field on the multi type that the single type lacks', () => {
    const routingOnly = new Set(['sessionId', 'pathwayId', 'pathwayTitle']);
    const missing = [...multi].filter((f) => !routingOnly.has(f) && !single.has(f));
    expect(missing).toEqual([]);
  });
});
