import { collapseLattice } from '../services/resolution/lattice-collapse';
import {
  MatchedPathway,
  MatchedCodeSet,
  MatchedCodeSetMember,
} from '../services/resolution/types';

// Mock findAncestors via jest.mock so the helper doesn't actually hit a DB.
jest.mock('../services/codes/icd10-hierarchy', () => ({
  findAncestors: jest.fn(),
}));
import { findAncestors } from '../services/codes/icd10-hierarchy';

// ─── Test fixtures ────────────────────────────────────────────────────

let pathwayIdCounter = 1;

function makeMatchedPathway(opts: {
  members: MatchedCodeSetMember[];
  title?: string;
}): MatchedPathway {
  const id = `path-${pathwayIdCounter++}`;
  const set: MatchedCodeSet = {
    setId: `set-${id}`,
    description: null,
    scope: 'EXACT',
    entryNodeId: null,
    members: opts.members,
    memberCount: opts.members.length,
  };
  return {
    pathway: {
      id,
      logicalId: `lp-${id}`,
      title: opts.title ?? `Pathway ${id}`,
      version: '1.0',
      category: 'CHRONIC_DISEASE',
      status: 'ACTIVE',
      conditionCodes: opts.members.map((m) => m.code),
    },
    matched: true,
    matchedSets: [set],
    mostSpecificMatchedSet: set,
    specificityDepth: opts.members.length,
    patientCodesAddressed: [],
    patientCodesUnaddressed: [],
    matchScore: 1,
    matchedConditionCodes: opts.members.map((m) => m.code),
  };
}

const fakePool = {} as any;

beforeEach(() => {
  pathwayIdCounter = 1;
  (findAncestors as jest.Mock).mockReset();
  (findAncestors as jest.Mock).mockResolvedValue([]); // default: no ancestors
});

// ─── Trivial cases ────────────────────────────────────────────────────

describe('collapseLattice — trivial cases', () => {
  it('returns the input unchanged when only one pathway is matched', async () => {
    const m = makeMatchedPathway({ members: [{ code: 'E11', system: 'ICD-10' }] });
    const result = await collapseLattice(fakePool, [m]);
    expect(result).toEqual([m]);
  });

  it('returns the input unchanged when input is empty', async () => {
    const result = await collapseLattice(fakePool, []);
    expect(result).toEqual([]);
  });

  it('keeps both pathways when their members are identical', async () => {
    const a = makeMatchedPathway({ members: [{ code: 'E11', system: 'ICD-10' }] });
    const b = makeMatchedPathway({ members: [{ code: 'E11', system: 'ICD-10' }] });
    const result = await collapseLattice(fakePool, [a, b]);
    expect(result).toHaveLength(2);
  });
});

// ─── Literal subset domination ────────────────────────────────────────

describe('collapseLattice — literal subset domination', () => {
  it('drops {I10} when {I10, E11} also matched', async () => {
    const broad = makeMatchedPathway({ members: [{ code: 'I10', system: 'ICD-10' }] });
    const specific = makeMatchedPathway({
      members: [
        { code: 'I10', system: 'ICD-10' },
        { code: 'E11', system: 'ICD-10' },
      ],
    });
    const result = await collapseLattice(fakePool, [broad, specific]);
    expect(result).toHaveLength(1);
    expect(result[0].pathway.id).toBe(specific.pathway.id);
  });

  it('drops both {I10} and {I10,E11} when {I10,E11,N18} also matched (chain collapse)', async () => {
    const a = makeMatchedPathway({ members: [{ code: 'I10', system: 'ICD-10' }] });
    const b = makeMatchedPathway({
      members: [
        { code: 'I10', system: 'ICD-10' },
        { code: 'E11', system: 'ICD-10' },
      ],
    });
    const c = makeMatchedPathway({
      members: [
        { code: 'I10', system: 'ICD-10' },
        { code: 'E11', system: 'ICD-10' },
        { code: 'N18', system: 'ICD-10' },
      ],
    });
    const result = await collapseLattice(fakePool, [a, b, c]);
    expect(result).toHaveLength(1);
    expect(result[0].pathway.id).toBe(c.pathway.id);
  });

  it('keeps non-comparable pathways with disjoint members', async () => {
    const htn = makeMatchedPathway({ members: [{ code: 'I10', system: 'ICD-10' }] });
    const migraine = makeMatchedPathway({
      members: [{ code: 'G43.909', system: 'ICD-10' }],
    });
    const result = await collapseLattice(fakePool, [htn, migraine]);
    expect(result).toHaveLength(2);
  });
});

// ─── Ontology-aware (ancestor) domination ─────────────────────────────

describe('collapseLattice — ICD-10 ancestor domination', () => {
  it('drops {E11} when {E11.65} also matched (E11 is ancestor of E11.65)', async () => {
    (findAncestors as jest.Mock).mockImplementation(async (_pool, code) => {
      if (code === 'E11.65') return ['E11', 'E11.6'];
      return [];
    });

    const broad = makeMatchedPathway({ members: [{ code: 'E11', system: 'ICD-10' }] });
    const specific = makeMatchedPathway({
      members: [{ code: 'E11.65', system: 'ICD-10' }],
    });
    const result = await collapseLattice(fakePool, [broad, specific]);
    expect(result).toHaveLength(1);
    expect(result[0].pathway.id).toBe(specific.pathway.id);
  });

  it('drops {E11} when {E11.65, I10} matched (E11 covered via E11.65 ancestry)', async () => {
    (findAncestors as jest.Mock).mockImplementation(async (_pool, code) => {
      if (code === 'E11.65') return ['E11', 'E11.6'];
      return [];
    });

    const broad = makeMatchedPathway({ members: [{ code: 'E11', system: 'ICD-10' }] });
    const specific = makeMatchedPathway({
      members: [
        { code: 'E11.65', system: 'ICD-10' },
        { code: 'I10', system: 'ICD-10' },
      ],
    });
    const result = await collapseLattice(fakePool, [broad, specific]);
    expect(result).toHaveLength(1);
    expect(result[0].pathway.id).toBe(specific.pathway.id);
  });

  it('keeps {E11.0} and {E11.65} (siblings under E11 — neither dominates)', async () => {
    (findAncestors as jest.Mock).mockImplementation(async (_pool, code) => {
      if (code === 'E11.0') return ['E11'];
      if (code === 'E11.65') return ['E11', 'E11.6'];
      return [];
    });

    const a = makeMatchedPathway({ members: [{ code: 'E11.0', system: 'ICD-10' }] });
    const b = makeMatchedPathway({ members: [{ code: 'E11.65', system: 'ICD-10' }] });
    const result = await collapseLattice(fakePool, [a, b]);
    expect(result).toHaveLength(2);
  });
});

// ─── Cross-system isolation ───────────────────────────────────────────

describe('collapseLattice — cross-system isolation', () => {
  it('does not consider an ICD-10 code to dominate a SNOMED code or vice versa', async () => {
    const icd = makeMatchedPathway({ members: [{ code: 'I10', system: 'ICD-10' }] });
    const snomed = makeMatchedPathway({
      members: [{ code: '38341003', system: 'SNOMED' }],
    });
    const result = await collapseLattice(fakePool, [icd, snomed]);
    expect(result).toHaveLength(2);
  });

  it('cross-system conjunctions: {I10 ICD-10} vs {I10 ICD-10 + RxNorm-1234}', async () => {
    // Broader pathway has just I10. Specific has I10 + a RxNorm code.
    const broad = makeMatchedPathway({ members: [{ code: 'I10', system: 'ICD-10' }] });
    const specific = makeMatchedPathway({
      members: [
        { code: 'I10', system: 'ICD-10' },
        { code: '11289', system: 'RXNORM' },
      ],
    });
    const result = await collapseLattice(fakePool, [broad, specific]);
    expect(result).toHaveLength(1);
    expect(result[0].pathway.id).toBe(specific.pathway.id);
  });
});

// ─── Caching ──────────────────────────────────────────────────────────

describe('collapseLattice — ancestor cache', () => {
  it('does not call findAncestors twice for the same code across pathways', async () => {
    (findAncestors as jest.Mock).mockResolvedValue([]);

    const a = makeMatchedPathway({ members: [{ code: 'E11', system: 'ICD-10' }] });
    const b = makeMatchedPathway({ members: [{ code: 'E11', system: 'ICD-10' }] });
    const c = makeMatchedPathway({ members: [{ code: 'E11', system: 'ICD-10' }] });
    await collapseLattice(fakePool, [a, b, c]);

    // Three pathways all reference E11; the cache should produce exactly one
    // findAncestors call for E11 (not three).
    expect((findAncestors as jest.Mock).mock.calls.filter((c) => c[1] === 'E11')).toHaveLength(1);
  });
});

// ─── Multi-pathway scenarios ──────────────────────────────────────────

describe('collapseLattice — multi-pathway scenarios', () => {
  it('correctly handles HTN+DM+CKD: drops broad pathways, keeps specific', async () => {
    (findAncestors as jest.Mock).mockResolvedValue([]);

    const htn = makeMatchedPathway({ members: [{ code: 'I10', system: 'ICD-10' }] });
    const dm = makeMatchedPathway({ members: [{ code: 'E11', system: 'ICD-10' }] });
    const ckd = makeMatchedPathway({ members: [{ code: 'N18', system: 'ICD-10' }] });
    const htnDm = makeMatchedPathway({
      members: [
        { code: 'I10', system: 'ICD-10' },
        { code: 'E11', system: 'ICD-10' },
      ],
    });
    const allThree = makeMatchedPathway({
      members: [
        { code: 'I10', system: 'ICD-10' },
        { code: 'E11', system: 'ICD-10' },
        { code: 'N18', system: 'ICD-10' },
      ],
    });

    const result = await collapseLattice(fakePool, [htn, dm, ckd, htnDm, allThree]);
    expect(result).toHaveLength(1);
    expect(result[0].pathway.id).toBe(allThree.pathway.id);
  });

  it('keeps comorbidity pathway + unrelated pathway side by side', async () => {
    const htnDm = makeMatchedPathway({
      members: [
        { code: 'I10', system: 'ICD-10' },
        { code: 'E11', system: 'ICD-10' },
      ],
    });
    const depression = makeMatchedPathway({
      members: [{ code: 'F32.9', system: 'ICD-10' }],
    });
    const result = await collapseLattice(fakePool, [htnDm, depression]);
    expect(result).toHaveLength(2);
  });

  it('AF + HFrEF: both kept (non-comparable, hard-conflict territory)', async () => {
    const af = makeMatchedPathway({ members: [{ code: 'I48.91', system: 'ICD-10' }] });
    const hfref = makeMatchedPathway({
      members: [{ code: 'I50.2', system: 'ICD-10' }],
    });
    const result = await collapseLattice(fakePool, [af, hfref]);
    expect(result).toHaveLength(2);
  });
});

// ─── Order preservation ───────────────────────────────────────────────

describe('collapseLattice — order preservation', () => {
  it('preserves relative order of surviving pathways', async () => {
    const a = makeMatchedPathway({ members: [{ code: 'F32.9', system: 'ICD-10' }] });
    const broadDropped = makeMatchedPathway({
      members: [{ code: 'I10', system: 'ICD-10' }],
    });
    const c = makeMatchedPathway({
      members: [
        { code: 'I10', system: 'ICD-10' },
        { code: 'E11', system: 'ICD-10' },
      ],
    });
    const result = await collapseLattice(fakePool, [a, broadDropped, c]);
    expect(result.map((m) => m.pathway.id)).toEqual([a.pathway.id, c.pathway.id]);
  });
});
