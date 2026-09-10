/**
 * A pass may only reconcile the red-flag types it can actually derive.
 *
 * Reconciliation DELETES an in-scope flag the pass did not re-derive. So
 * claiming a type traversal cannot produce means quietly erasing another
 * subsystem's finding on any node the pass happens to touch — which is what
 * reconciling the full `RED_FLAG_TYPES` did, `contradiction` included, a type
 * nothing in the service produces.
 *
 * This reads the ENGINE SOURCE rather than a declaration, and checks both
 * directions. That is the lesson from the scorer-input map: a test that only
 * verifies a hand-written list against another hand-written list confirms the
 * two agree, not that either is true.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  RECONCILABLE_RED_FLAG_TYPES,
  RED_FLAG_TYPES,
} from '../services/resolution/findings-reconciliation';

const ENGINE = readFileSync(
  join(__dirname, '../services/resolution/traversal-engine.ts'),
  'utf-8',
);

/** Every `type: '...'` literal the engine puts on a red flag it pushes. */
function typesRaisedByEngine(): Set<string> {
  const known = new Set<string>(RED_FLAG_TYPES);
  const found = new Set<string>();
  for (const m of ENGINE.matchAll(/type:\s*'([a-z_]+)'/g)) {
    if (known.has(m[1])) found.add(m[1]);
  }
  return found;
}

describe('reconcilable red-flag types', () => {
  it('claims every type the engine actually raises', () => {
    const raised = [...typesRaisedByEngine()].sort();
    const claimed = [...RECONCILABLE_RED_FLAG_TYPES].sort();
    // A type the engine raises but does not claim accumulates for ever: the
    // append bug, back for that type only.
    expect(raised.filter(t => !claimed.includes(t))).toEqual([]);
  });

  it('claims nothing the engine cannot raise', () => {
    const raised = typesRaisedByEngine();
    // A type claimed but never derived is DELETED from every node the pass
    // touches, however it got there.
    expect([...RECONCILABLE_RED_FLAG_TYPES].filter(t => !raised.has(t))).toEqual([]);
  });

  it('excludes contradiction, which nothing produces', () => {
    expect(RECONCILABLE_RED_FLAG_TYPES).not.toContain('contradiction');
  });

  // The wider list is still the vocabulary; it is just not one pass's
  // authority.
  it('is a subset of the full vocabulary', () => {
    for (const t of RECONCILABLE_RED_FLAG_TYPES) {
      expect(RED_FLAG_TYPES).toContain(t);
    }
  });
});
