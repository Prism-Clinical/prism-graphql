/**
 * A gate with several branch targets must map every possible answer to exactly
 * one of them.
 *
 * The two failure modes are different authoring mistakes and get different
 * errors: an answer matching NO branch routes nowhere — the presence-only bug
 * in a new costume — and an answer matching TWO opens both arms, which is the
 * multi-arm bug.
 *
 * The live case this exists for is gate-etiology on
 * vaginal-discharge-pregnancy-v1: five SELECT options, five treatment
 * branches, and today answering any one of them opens all five.
 */

import { validatePathwayJson } from '../services/import/validator';
import { clonePathway } from './fixtures/reference-pathway';
import { parseBranchWhen, checkNumericCover } from '../services/import/branch-when';

// ─── The unit ─────────────────────────────────────────────────────────

describe('parseBranchWhen', () => {
  it('reads an equals mapping for SELECT and BOOLEAN', () => {
    expect(parseBranchWhen({ equals: 'Trichomoniasis' })).toEqual({ equals: 'Trichomoniasis' });
    expect(parseBranchWhen({ equals: true })).toEqual({ equals: true });
  });

  it('reads a half-open range', () => {
    expect(parseBranchWhen({ gte: 7, lt: 11 })).toEqual({ gte: 7, lt: 11 });
    expect(parseBranchWhen({ lt: 7 })).toEqual({ lt: 7 });
    expect(parseBranchWhen({ gte: 11 })).toEqual({ gte: 11 });
  });

  // A guess here routes a patient down a treatment arm.
  it('refuses anything uninterpretable rather than guessing', () => {
    expect(parseBranchWhen(undefined)).toBeNull();
    expect(parseBranchWhen('Trichomoniasis')).toBeNull();
    expect(parseBranchWhen({})).toBeNull();
    expect(parseBranchWhen({ equals: { nested: 1 } })).toBeNull();
    expect(parseBranchWhen({ gte: 'seven' })).toBeNull();
    expect(parseBranchWhen({ gte: 11, lt: 7 })).toBeNull();
  });
});

describe('checkNumericCover', () => {
  it('accepts ranges that tile the line', () => {
    expect(checkNumericCover([{ lt: 7 }, { gte: 7, lt: 11 }, { gte: 11 }])).toBeNull();
  });

  it('reports a gap', () => {
    const err = checkNumericCover([{ lt: 7 }, { gte: 11 }]);
    expect(err).toContain('[7, 11)');
  });

  it('reports an overlap', () => {
    const err = checkNumericCover([{ lt: 11 }, { gte: 7 }]);
    expect(err).toMatch(/overlap/i);
  });

  it('reports an uncovered tail', () => {
    expect(checkNumericCover([{ lt: 7 }, { gte: 7, lt: 11 }])).toMatch(/at or above 11/);
  });
});

// ─── Import validation ────────────────────────────────────────────────

type Branch = { to: string; when?: unknown };

/** A gate with N branch targets, each optionally carrying a `when`. */
function withGate(props: Record<string, unknown>, branches: Branch[]) {
  const pw = clonePathway();
  pw.nodes.push({ id: 'gate-r', type: 'Gate' as never, properties: props } as never);
  pw.edges.push({ from: 'step-1-1', to: 'gate-r', type: 'HAS_GATE' } as never);
  for (const b of branches) {
    pw.edges.push({
      from: 'gate-r',
      to: b.to,
      type: 'BRANCHES_TO',
      ...(b.when !== undefined ? { properties: { when: b.when } } : {}),
    } as never);
  }
  return pw;
}

const SELECT_GATE = {
  title: 'Established aetiology?',
  gate_type: 'question',
  default_behavior: 'skip',
  answer_type: 'select',
  options: ['BV', 'VVC'],
};

describe('branch routing validation', () => {
  it('accepts a SELECT gate whose every option is mapped', () => {
    const pw = withGate(SELECT_GATE, [
      { to: 'step-1-2', when: { equals: 'BV' } },
      { to: 'step-1-3', when: { equals: 'VVC' } },
    ]);
    const r = validatePathwayJson(pw);
    expect(r.errors.filter(e => e.includes('gate-r'))).toEqual([]);
  });

  // The fall-through case: an answer that routes nowhere.
  it('rejects a SELECT option no branch claims', () => {
    const pw = withGate(SELECT_GATE, [
      { to: 'step-1-2', when: { equals: 'BV' } },
      { to: 'step-1-3', when: { equals: 'BV' } },
    ]);
    const r = validatePathwayJson(pw);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('VVC');
  });

  // The multi-arm case: an answer that opens two branches.
  it('rejects two branches claiming one option', () => {
    const pw = withGate(SELECT_GATE, [
      { to: 'step-1-2', when: { equals: 'BV' } },
      { to: 'step-1-3', when: { equals: 'BV' } },
    ]);
    const r = validatePathwayJson(pw);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/BV/);
  });

  it('rejects a branch claiming an option the gate does not offer', () => {
    const pw = withGate(SELECT_GATE, [
      { to: 'step-1-2', when: { equals: 'BV' } },
      { to: 'step-1-3', when: { equals: 'Trichomoniasis' } },
    ]);
    const r = validatePathwayJson(pw);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('Trichomoniasis');
  });

  it('accepts a BOOLEAN gate with true and false branches', () => {
    const pw = withGate(
      { ...SELECT_GATE, answer_type: 'boolean', options: undefined },
      [
        { to: 'step-1-2', when: { equals: true } },
        { to: 'step-1-3', when: { equals: false } },
      ],
    );
    expect(validatePathwayJson(pw).errors.filter(e => e.includes('gate-r'))).toEqual([]);
  });

  it('rejects a BOOLEAN gate missing the false branch', () => {
    const pw = withGate(
      { ...SELECT_GATE, answer_type: 'boolean', options: undefined },
      [
        { to: 'step-1-2', when: { equals: true } },
        { to: 'step-1-3', when: { equals: true } },
      ],
    );
    expect(validatePathwayJson(pw).valid).toBe(false);
  });

  it('accepts NUMERIC ranges that tile the line', () => {
    const pw = withGate(
      { ...SELECT_GATE, answer_type: 'numeric', options: undefined },
      [
        { to: 'step-1-2', when: { lt: 7 } },
        { to: 'step-1-3', when: { gte: 7 } },
      ],
    );
    expect(validatePathwayJson(pw).errors.filter(e => e.includes('gate-r'))).toEqual([]);
  });

  it('rejects a NUMERIC gap', () => {
    const pw = withGate(
      { ...SELECT_GATE, answer_type: 'numeric', options: undefined },
      [
        { to: 'step-1-2', when: { lt: 7 } },
        { to: 'step-1-3', when: { gte: 11 } },
      ],
    );
    const r = validatePathwayJson(pw);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toContain('[7, 11)');
  });

  // No new burden on existing pathways: every gate on the ACTIVE anaemia
  // pathway is single-target, and traversing the one branch IS the routing.
  it('accepts a single-target gate with no when at all', () => {
    const pw = withGate(SELECT_GATE, [{ to: 'step-1-2' }]);
    expect(validatePathwayJson(pw).errors.filter(e => e.includes('gate-r'))).toEqual([]);
  });

  it('rejects a multi-target gate with no when anywhere', () => {
    const pw = withGate(SELECT_GATE, [{ to: 'step-1-2' }, { to: 'step-1-3' }]);
    const r = validatePathwayJson(pw);
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/when/i);
  });
});
