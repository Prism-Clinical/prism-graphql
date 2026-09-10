/**
 * Findings are RECONCILED against what a pass re-derived, not appended to.
 *
 * Appending meant a still-true finding re-emitted a duplicate on every pass
 * and a resolved one was never removed. Care-plan generation blocks on every
 * unacknowledged red flag, so a flag true for one instant blocked that session
 * for ever.
 */

import {
  reconcileRedFlags,
  reconcilePendingQuestions,
  redFlagKey,
  pendingQuestionKey,
  RED_FLAG_TYPES,
} from '../services/resolution/findings-reconciliation';
import { RedFlag, PendingQuestion, AnswerType } from '../services/resolution/types';

const flag = (nodeId: string, type = 'all_branches_excluded', extra: Partial<RedFlag> = {}) =>
  ({ nodeId, nodeTitle: nodeId, type, description: `${type} on ${nodeId}`, ...extra }) as RedFlag;

const q = (gateId: string, extra: Partial<PendingQuestion> = {}) =>
  ({ gateId, prompt: `${gateId}?`, answerType: AnswerType.BOOLEAN,
     affectedSubtreeSize: 1, estimatedImpact: 'low', ...extra }) as PendingQuestion;

const ALL = { types: RED_FLAG_TYPES };

describe('redFlagKey', () => {
  it('distinguishes two flag types on one node', () => {
    // One node can carry two different flags; collapsing them would let one
    // acknowledgement silence the other.
    expect(redFlagKey({ nodeId: 'n1', type: 'contradiction' }))
      .not.toEqual(redFlagKey({ nodeId: 'n1', type: 'missing_critical_data' }));
  });

  it('uses a printable separator, so the file stays text to git', () => {
    const key = redFlagKey({ nodeId: 'n1', type: 'contradiction' });
    expect(key).not.toMatch(/[\u0000-\u001F]/);
  });
});

describe('reconcileRedFlags', () => {
  it('replaces a re-derived flag in place rather than duplicating it', () => {
    const existing = [flag('n1'), flag('n2')];
    const out = reconcileRedFlags(existing, [flag('n1')], { nodeIds: ['n1'], ...ALL });
    expect(out).toHaveLength(2);
    expect(out[0].nodeId).toBe('n1'); // stored order kept
  });

  // The defect that blocked generation for ever.
  it('drops a flag the pass no longer derives', () => {
    const out = reconcileRedFlags([flag('n1')], [], { nodeIds: ['n1'], ...ALL });
    expect(out).toEqual([]);
  });

  it('keeps a flag about a node the pass never looked at', () => {
    const out = reconcileRedFlags([flag('n9')], [], { nodeIds: ['n1'], ...ALL });
    expect(out).toHaveLength(1);
    expect(out[0].nodeId).toBe('n9');
  });

  // Otherwise reconciliation and acknowledgement cancel out: the provider
  // accepts a still-true flag and the next pass resurrects it unacknowledged.
  it('carries an acknowledgement across re-derivation', () => {
    const out = reconcileRedFlags(
      [flag('n1', 'contradiction', { acknowledged: true })],
      [flag('n1', 'contradiction')],
      { nodeIds: ['n1'], ...ALL },
    );
    expect(out[0].acknowledged).toBe(true);
  });

  it('cleans up duplicates an earlier append left behind', () => {
    const out = reconcileRedFlags([flag('n1'), flag('n1')], [flag('n1')], { nodeIds: ['n1'], ...ALL });
    expect(out).toHaveLength(1);
  });

  // A finding the caller cannot place means engine and caller disagree about
  // what was re-evaluated; appending it would restore the unbounded growth.
  it('refuses a derived flag outside the declared scope', () => {
    expect(() => reconcileRedFlags([], [flag('n9')], { nodeIds: ['n1'], ...ALL })).toThrow(/scope/);
  });

  it('covers every RedFlagType, so no type is silently unreconcilable', () => {
    for (const t of RED_FLAG_TYPES) {
      expect(() => reconcileRedFlags([], [flag('n1', t)], { nodeIds: ['n1'], ...ALL })).not.toThrow();
    }
  });
});

describe('reconcilePendingQuestions', () => {
  it('drops a question the pass no longer asks', () => {
    const out = reconcilePendingQuestions([q('g1')], [], { gateIds: ['g1'] });
    expect(out).toEqual([]);
  });

  it('keeps a question about a gate the pass never looked at', () => {
    const out = reconcilePendingQuestions([q('g9')], [], { gateIds: ['g1'] });
    expect(out).toHaveLength(1);
  });

  it('drops the gate just answered even if the pass re-derived nothing', () => {
    const out = reconcilePendingQuestions([q('g1')], [], { gateIds: [], alsoDropGateIds: ['g1'] });
    expect(out).toEqual([]);
  });

  /**
   * Two gates needing the same haemoglobin ask ONCE, so a datum prompt's
   * identity is the datum — not whichever gate raised it first. Keying on
   * gateId would let the second gate re-derive a duplicate request for a value
   * already asked for.
   */
  it('identifies a datum request by its datum, not by the gate', () => {
    expect(pendingQuestionKey(q('g1', { datumKey: 'lab:718-7' })))
      .toEqual(pendingQuestionKey(q('g2', { datumKey: 'lab:718-7' })));
  });

  it('does not duplicate one datum request raised by two gates', () => {
    const out = reconcilePendingQuestions(
      [q('g1', { datumKey: 'lab:718-7' })],
      [q('g1', { datumKey: 'lab:718-7' }), q('g2', { datumKey: 'lab:718-7' })],
      { gateIds: ['g1', 'g2'] },
    );
    expect(out).toHaveLength(1);
  });

  it('refuses a derived question outside the declared scope', () => {
    expect(() => reconcilePendingQuestions([], [q('g9')], { gateIds: ['g1'] })).toThrow(/scope/);
  });
});

/**
 * A shared datum prompt outlives the gate that raised it.
 *
 * Two gates needing one haemoglobin ask ONCE. When the gate that happened to
 * raise it resolves, the prompt used to go with it — while the other gate,
 * outside the re-resolved region and so unable to re-derive anything, still
 * needed the value. The session pended with no question able to clear it.
 *
 * Demand is read from the resolution STATE, not from the owner list: the list
 * says who might need the datum, the state says who still does.
 */
describe('shared datum prompts', () => {
  const shared = q('g1', { datumKey: 'lab:718-7', askedByNodeIds: ['g1', 'g2'] });

  it('survives when another owner is still pending', () => {
    const out = reconcilePendingQuestions([shared], [], {
      gateIds: ['g1'],                       // only g1 was re-disposed
      stillPending: (id) => id === 'g2',     // g2 still waits on the value
    });
    expect(out).toHaveLength(1);
    // Re-homed, so it no longer points at a gate that has resolved.
    expect(out[0].gateId).toBe('g2');
  });

  it('is dropped once no owner needs it', () => {
    const out = reconcilePendingQuestions([shared], [], {
      gateIds: ['g1'],
      stillPending: () => false,
    });
    expect(out).toEqual([]);
  });

  // The state is the authority: an owner that resolved stops counting without
  // anyone having to remember to remove it from the list.
  it('ignores an owner the state says is no longer pending', () => {
    const out = reconcilePendingQuestions([shared], [], {
      gateIds: ['g1'],
      stillPending: (id) => id === 'g1',   // only the resolved gate
    });
    expect(out).toHaveLength(1);
    expect(out[0].gateId).toBe('g1');
  });

  // Without the predicate the old rule stands, so existing callers are unchanged.
  it('drops an unre-derived prompt when no predicate is supplied', () => {
    const out = reconcilePendingQuestions([shared], [], { gateIds: ['g1'] });
    expect(out).toEqual([]);
  });

  /**
   * A pass only re-derives the gates it disposed. A prompt owned by [g1, g2]
   * where only g1 was in the region came back claiming [g1] alone — so when
   * g1 later resolved the prompt vanished, while g2, never re-disposed and so
   * never able to re-assert itself, still needed the value.
   */
  it('keeps a still-pending owner the pass could not re-derive', () => {
    const out = reconcilePendingQuestions(
      [shared],                                              // owned by g1 and g2
      [q('g1', { datumKey: 'lab:718-7', askedByNodeIds: ['g1'] })],
      { gateIds: ['g1'], stillPending: (id) => id === 'g2' },  // only g1 re-disposed
    );
    expect(out).toHaveLength(1);
    expect(out[0].askedByNodeIds).toEqual(expect.arrayContaining(['g1', 'g2']));
  });

  it('does not resurrect an owner the state says has resolved', () => {
    const out = reconcilePendingQuestions(
      [shared],
      [q('g1', { datumKey: 'lab:718-7', askedByNodeIds: ['g1'] })],
      { gateIds: ['g1'], stillPending: () => false },
    );
    expect(out[0].askedByNodeIds).toEqual(['g1']);
  });

  it('merges owner claims when two gates derive one datum in a pass', () => {
    const out = reconcilePendingQuestions(
      [],
      [
        q('g1', { datumKey: 'lab:718-7', askedByNodeIds: ['g1'] }),
        q('g2', { datumKey: 'lab:718-7', askedByNodeIds: ['g2'] }),
      ],
      { gateIds: ['g1', 'g2'] },
    );
    expect(out).toHaveLength(1);
    expect(out[0].askedByNodeIds).toEqual(['g1', 'g2']);
  });
});
