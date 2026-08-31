/**
 * Plan 04 Task 9 — the assembler is wired at every entry point, under `v1` only.
 *
 * Five sites: `startResolution`, `overrideNode`, `answerPendingDecision`,
 * `addPatientContext`, and the multi-pathway `resolveAndPersistAll`. Until this
 * task `assembleContext` had no callers at all and `deps.factStore` was `[]` in
 * production, so every `v1` proof so far was a unit test.
 *
 * THE ASSEMBLER IS SPIED ON DIRECTLY, not inferred from an empty store. P1-9 is
 * not "legacy-v0 gets an empty array" — it is "legacy-v0 never runs the
 * validating code at all". `assembleContext` calls `parseClinicalState`,
 * `parseRecordValidity`, `parseSyntheticDate` and `assertOrdered`, every one of
 * which throws; calling it unconditionally would turn a `legacy-v0` request
 * carrying a malformed date or an inverted interval into a session-creation
 * rejection, for a store the legacy path never reads. An empty-array assertion
 * cannot tell "never called" from "called and returned nothing".
 *
 * The mock set mirrors pathway-defaults-threading.test.ts: `jest.mock` with a
 * factory replaces the WHOLE module, so any export a resolver imports and the
 * factory omits is `undefined` at call time.
 */

const traversalCtor = jest.fn();
// One engine now, so one constructor spy. The alias is kept where assertions
// read as "the incremental construction" — in these mutations only the
// incremental engine is built, so the two names observe the same single call.
const retraversalCtor = traversalCtor;
const mockTraverse = jest.fn();
const mockRetraverse = jest.fn();

jest.mock('../../resolvers/Query', () => ({
  PATHWAY_COLUMNS: 'id, version, status',
  formatSessionForGraphQL: (s: unknown) => s,
  hydrateSignalDefinition: (row: unknown) => row,
}));

jest.mock('../../services/resolution/traversal-engine', () => ({
  TraversalEngine: class {
    constructor(...args: unknown[]) {
      traversalCtor(...args);
    }
    traverse = mockTraverse;
    resolveIncrementally = mockRetraverse;
  },
}));

jest.mock('../../services/resolution/session-store', () => ({
  createSession: jest.fn().mockResolvedValue('session-1'),
  getSession: jest.fn(),
  updateSession: jest.fn().mockResolvedValue(undefined),
  logEvent: jest.fn().mockResolvedValue(undefined),
  logNodeOverride: jest.fn().mockResolvedValue(undefined),
  logGateAnswer: jest.fn().mockResolvedValue(undefined),
  getMatchedPathways: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/resolution/multi-pathway-session-store', () => ({
  createMultiPathwaySession: jest.fn().mockResolvedValue('mp-1'),
  getMultiPathwaySession: jest.fn().mockResolvedValue({
    id: 'mp-1',
    patientId: 'pt',
    providerId: 'pr',
    status: 'ACTIVE',
    isPreview: false,
    initialPatientContext: {},
    contributingSessionIds: [],
    contributingPathwayIds: [],
    // Must be the full `MergedCarePlan` shape — `formatMergedForGraphQL`
    // maps every array unguarded, so a thinner stub dies in the formatter
    // instead of in the code under test.
    mergedPlan: {
      sourcePathwayIds: [],
      medications: [],
      labs: [],
      imaging: [],
      procedures: [],
      guidance: [],
      schedules: [],
      qualityMetrics: [],
      suppressed: [],
      conflicts: [],
      catchUpItems: [],
      evidenceTrail: [],
      dataGapHints: [],
    },
    conflictResolutions: {},
    ddiWarnings: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
  getPatientMultiPathwaySessions: jest.fn(),
  markMultiPathwaySessionStatus: jest.fn(),
  updateMergedPlanAndResolutions: jest.fn(),
  deletePreviewSession: jest.fn(),
}));

jest.mock('../../services/medications/ddi-pass-single-pathway', () => ({
  applyDdiToResolutionState: jest.fn().mockResolvedValue({ findings: [] }),
}));

jest.mock('../../services/medications/ddi-pass', () => ({
  runPatientContextDdi: jest.fn().mockResolvedValue({
    findings: [],
    suppressedRecommendationIds: new Set(),
  }),
  runCrossRecommendationDdi: jest.fn().mockResolvedValue({
    findings: [],
    suppressedRecommendationIds: new Set(),
  }),
}));

jest.mock('../../services/resolution/lattice-collapse', () => ({
  collapseLattice: jest.fn((_pool: unknown, matched: unknown[]) => Promise.resolve(matched)),
}));

// The assembler stays REAL — only wrapped, so "was it called" is observable.
jest.mock('../../services/resolution/temporal/context-assembler', () => {
  const actual = jest.requireActual('../../services/resolution/temporal/context-assembler');
  return { ...actual, assembleContext: jest.fn(actual.assembleContext) };
});

const mockBuildResolutionContext = jest.fn();
jest.mock('../../resolvers/helpers/resolution-context', () => ({
  ...jest.requireActual('../../resolvers/helpers/resolution-context'),
  buildResolutionContext: (...a: unknown[]) => mockBuildResolutionContext(...a),
  makeTraversalAdapter: jest.fn(() => ({ computeNodeConfidence: jest.fn() })),
  makeRetraversalAdapter: jest.fn(() => ({ computeNodeConfidence: jest.fn() })),
  makeLlmGateEvaluator: jest.fn(() => null),
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import { parse, Kind } from 'graphql';
import { getSession, createSession } from '../../services/resolution/session-store';
import { createMultiPathwaySession } from '../../services/resolution/multi-pathway-session-store';
import { assembleContext } from '../../services/resolution/temporal/context-assembler';
import { resolutionMutations } from '../../resolvers/mutations/resolution';
import {
  multiPathwayResolutionMutations,
} from '../../resolvers/mutations/multi-pathway-resolution';
import { getMatchedPathways } from '../../services/resolution/session-store';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import {
  NodeStatus,
  OverrideAction,
  createEmptyDependencyMap,
} from '../../services/resolution/types';
import type { MatchedPathway } from '../../services/resolution/types';
import type { FactStore } from '../../services/resolution/temporal/fact-model';

const mockedGetSession = getSession as jest.MockedFunction<typeof getSession>;
const mockedCreateSession = createSession as jest.MockedFunction<typeof createSession>;
const mockedCreateMp = createMultiPathwaySession as jest.MockedFunction<
  typeof createMultiPathwaySession
>;
const mockedGetMatched = getMatchedPathways as jest.MockedFunction<typeof getMatchedPathways>;
const mockedAssemble = assembleContext as jest.MockedFunction<typeof assembleContext>;

const PINNED = '2026-01-15T08:30:00.000Z';
const CLOCK_V1 = makeEvaluationTemporalContext({
  evaluationAsOf: PINNED,
  temporalPolicyVersion: 'v1',
});
// Pinned, not inherited. This used to get legacy-v0 from
// DEFAULT_TEMPORAL_POLICY_VERSION; when that default moved to v1 the constant
// kept its name and silently changed meaning, so every "under legacy-v0"
// assertion built on it was really running the kernel.
const CLOCK_LEGACY = makeEvaluationTemporalContext({
  evaluationAsOf: PINNED,
  temporalPolicyVersion: 'legacy-v0',
});

/**
 * The constructor position `factStore` occupies on both engines: after the
 * confidence adapter, the thresholds, the clock and the pathway defaults, and
 * BEFORE the optional LLM evaluator. Required rather than optional-with-default
 * for the reason P1-10 promoted `pathwayDefaults` and R11-4 flags for `codeMap`:
 * omitted at one site, every `v1` gate selects from nothing and answers a quiet
 * `false`.
 */
const FACT_STORE_ARG = 4;

function rctx() {
  return {
    graphContext: {
      allNodes: [
        { id: 's-1', nodeIdentifier: 's-1', nodeType: 'Step', properties: { title: 's-1' } },
      ],
      allEdges: [],
      incomingEdges: () => [],
      outgoingEdges: () => [],
      getNode: () => undefined,
      linkedNodes: () => [],
    },
    edges: [],
    signals: [],
    thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    confidenceEngine: {},
    codeMap: new Map(),
    temporalDefaults: {},
  };
}

function traversalResult() {
  return {
    resolutionState: new Map(),
    dependencyMap: createEmptyDependencyMap(),
    pendingQuestions: [],
    redFlags: [],
    totalNodesEvaluated: 1,
    traversalDurationMs: 1,
    isDegraded: false,
  };
}

/** One diabetes condition — enough to make an assembled store non-empty. */
const PAYLOAD = {
  patientId: 'pt-1',
  conditionCodes: [{ code: 'E11.9', system: 'ICD-10', display: 'T2DM' }],
  medications: [],
  labResults: [],
  allergies: [],
};

/** An interval that ends before it starts — `assertOrdered` rejects it. */
const INVERTED = {
  patientId: 'pt-1',
  conditionCodes: [
    {
      code: 'E11.9',
      system: 'ICD-10',
      date: '2026-01-10',
      endDate: '2026-01-02',
    },
  ],
  medications: [],
  labResults: [],
  allergies: [],
};

/** A lab whose `date` is not a FHIR date — `parseSyntheticDate` rejects it. */
const MALFORMED_DATE = {
  patientId: 'pt-1',
  conditionCodes: [],
  medications: [],
  labResults: [{ code: '718-7', system: 'LOINC', value: 9.1, date: 'last tuesday' }],
  allergies: [],
};

function gqlContext(temporalPolicyVersion?: string, userRole = 'PROVIDER') {
  const base: Record<string, unknown> = {
    pool: poolStub,
    redis: {},
    userId: 'u-1',
    userRole,
  };
  if (temporalPolicyVersion !== undefined) base.temporalPolicyVersion = temporalPolicyVersion;
  return base as never;
}

const poolStub = {
  query: jest.fn().mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] }),
  connect: jest.fn(),
};

function sessionWith(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    pathwayId: 'pathway-1',
    pathwayVersion: '1',
    patientId: 'pt',
    providerId: 'pr',
    status: 'ACTIVE',
    resolutionState: new Map([
      ['node-1', { nodeId: 'node-1', nodeType: 'Step', title: 'n1', status: NodeStatus.INCLUDED, confidence: 1, confidenceBreakdown: [], depth: 1 }],
      ['node-2', { nodeId: 'node-2', nodeType: 'Step', title: 'n2', status: NodeStatus.INCLUDED, confidence: 1, confidenceBreakdown: [], depth: 2 }],
    ]),
    dependencyMap: {
      influencedBy: new Map(),
      influences: new Map([['node-1', new Set(['node-2'])]]),
      gateContextFields: new Map([['gate-1', new Set(['labs'])]]),
      scorerInputs: new Map(),
    },
    initialPatientContext: {
      patientId: 'pt',
      conditionCodes: [{ code: 'E11.9', system: 'ICD-10' }],
      medications: [],
      labResults: [],
      allergies: [],
    },
    additionalContext: {},
    pendingQuestions: [],
    redFlags: [],
    resolutionEvents: [],
    gateAnswers: new Map(),
    totalNodesEvaluated: 2,
    traversalDurationMs: 1,
    ddiWarnings: [],
    temporalContext: CLOCK_LEGACY,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function matchedPathway(id: string): MatchedPathway {
  return {
    pathway: {
      id,
      logicalId: `l-${id}`,
      title: id,
      version: '1',
      category: 'c',
      status: 'ACTIVE',
      conditionCodes: [],
    },
    matched: true,
    matchedSets: [],
    mostSpecificMatchedSet: {},
    specificityDepth: 0,
    patientCodesAddressed: [],
    patientCodesUnaddressed: [],
  } as unknown as MatchedPathway;
}

/** The store the engine at `call` was constructed with. */
const storeAt = (spy: jest.Mock, call = 0): FactStore =>
  spy.mock.calls[call][FACT_STORE_ARG] as FactStore;

/**
 * The version actually PERSISTED on the session row.
 *
 * `formatSessionForGraphQL` (multi-pathway-resolution.ts:1150-1164) does not
 * return `temporalContext`, and that exposure belongs to plan 08 — so the
 * payload cannot be asserted on. `createSession`'s argument is what
 * session-temporal-context.test.ts already pins as the value that reaches the
 * `temporal_context` column.
 */
const persistedVersionOf = (spy: jest.Mock, call = 0): string =>
  (spy.mock.calls[call][1] as { temporalContext: { temporalPolicyVersion: string } })
    .temporalContext.temporalPolicyVersion;

beforeEach(() => {
  jest.clearAllMocks();
  poolStub.query.mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] });
  mockBuildResolutionContext.mockResolvedValue(rctx());
  mockTraverse.mockResolvedValue(traversalResult());
  mockRetraverse.mockResolvedValue({
    statusChanges: [],
    pendingQuestions: [],
    redFlags: [],
    nodesRecomputed: 0,
    isIncomplete: false,
  });
  mockedCreateSession.mockResolvedValue('session-1');
  mockedCreateMp.mockResolvedValue('mp-1');
  mockedGetMatched.mockResolvedValue([]);
  mockedGetSession.mockResolvedValue(sessionWith() as never);
});

// ─────────────────────────────────────────────────────────────────────

describe('legacy-v0 never invokes the assembler (P1-9)', () => {
  it('starts a session whose context would fail assembly validation', async () => {
    await expect(
      resolutionMutations.startResolution(
        null as never,
        {
          pathwayId: 'pw-1',
          patientId: 'pt-1',
          resolutionMode: 'SYNTHETIC',
          patientContext: INVERTED,
        } as never,
        gqlContext('legacy-v0', 'ADMIN'),
      ),
    ).resolves.toBeDefined();

    expect(mockedAssemble).not.toHaveBeenCalled();
  });

  it('starts a session carrying a lab date the assembler cannot parse', async () => {
    await expect(
      resolutionMutations.startResolution(
        null as never,
        { pathwayId: 'pw-1', patientId: 'pt-1', patientContext: MALFORMED_DATE } as never,
        gqlContext('legacy-v0'),
      ),
    ).resolves.toBeDefined();

    expect(mockedAssemble).not.toHaveBeenCalled();
  });

  it('rejects that same context under v1', async () => {
    await expect(
      resolutionMutations.startResolution(
        null as never,
        {
          pathwayId: 'pw-1',
          patientId: 'pt-1',
          resolutionMode: 'SYNTHETIC',
          patientContext: INVERTED,
        } as never,
        gqlContext('v1', 'ADMIN'),
      ),
    ).rejects.toThrow(/endDate .* is before date/);

    expect(mockedCreateSession).not.toHaveBeenCalled();
  });

  it('rejects the malformed lab date under v1', async () => {
    await expect(
      resolutionMutations.startResolution(
        null as never,
        { pathwayId: 'pw-1', patientId: 'pt-1', patientContext: MALFORMED_DATE } as never,
        gqlContext('v1'),
      ),
    ).rejects.toThrow(/is not a valid FHIR date/);
  });

  it('passes an empty fact store to the engine under legacy-v0 (startResolution)', async () => {
    await resolutionMutations.startResolution(
      null as never,
      { pathwayId: 'pw-1', patientId: 'pt-1', patientContext: PAYLOAD } as never,
      gqlContext('legacy-v0'),
    );

    expect(traversalCtor).toHaveBeenCalledTimes(1);
    expect(storeAt(traversalCtor)).toEqual([]);
    expect(mockedAssemble).not.toHaveBeenCalled();
  });

  it('passes an empty fact store on every retraversal entry point under legacy-v0', async () => {
    await resolutionMutations.overrideNode(
      undefined,
      { sessionId: 'session-1', nodeId: 'node-1', action: OverrideAction.EXCLUDE, reason: 'r' },
      gqlContext('legacy-v0'),
    );
    expect(storeAt(retraversalCtor)).toEqual([]);

    retraversalCtor.mockClear();
    mockedGetSession.mockResolvedValue(
      sessionWith({
        resolutionState: new Map([
          ['gate-1', { nodeId: 'gate-1', nodeType: 'Gate', title: 'g1', status: NodeStatus.PENDING_QUESTION, confidence: 0, confidenceBreakdown: [], depth: 1 }],
        ]),
      }) as never,
    );
    await resolutionMutations.answerPendingDecision(
      undefined,
      { sessionId: 'session-1', nodeId: 'gate-1', answer: { booleanValue: true } },
      gqlContext('legacy-v0'),
    );
    expect(storeAt(retraversalCtor)).toEqual([]);

    retraversalCtor.mockClear();
    mockedGetSession.mockResolvedValue(sessionWith() as never);
    await resolutionMutations.addPatientContext(
      undefined,
      {
        sessionId: 'session-1',
        additionalContext: { labResults: [{ code: '718-7', system: 'LOINC', value: 9.1 }] },
      },
      gqlContext('legacy-v0'),
    );
    expect(storeAt(retraversalCtor)).toEqual([]);

    expect(mockedAssemble).not.toHaveBeenCalled();
  });

  it('passes an empty fact store on the multi-pathway path under legacy-v0', async () => {
    mockedGetMatched.mockResolvedValue([matchedPathway('pw-1')] as never);

    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      null as never,
      { patientId: 'pt-1', patientContext: PAYLOAD } as never,
      gqlContext('legacy-v0'),
    );

    expect(traversalCtor).toHaveBeenCalledTimes(1);
    expect(storeAt(traversalCtor)).toEqual([]);
    expect(mockedAssemble).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('every engine entry point assembles under v1', () => {
  it('startResolution builds facts from the SYNTHETIC payload', async () => {
    await resolutionMutations.startResolution(
      null as never,
      { pathwayId: 'pw-1', patientId: 'pt-1', patientContext: PAYLOAD } as never,
      gqlContext('v1'),
    );

    expect(mockedAssemble).toHaveBeenCalledTimes(1);
    const store = storeAt(traversalCtor);
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({ kind: 'condition', code: 'E11.9', system: 'ICD-10' });
  });

  it('startMultiPathwayResolution builds facts for each child session', async () => {
    mockedGetMatched.mockResolvedValue([
      matchedPathway('pw-1'),
      matchedPathway('pw-2'),
      matchedPathway('pw-3'),
    ] as never);

    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      null as never,
      { patientId: 'pt-1', patientContext: PAYLOAD } as never,
      gqlContext('v1'),
    );

    expect(traversalCtor).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      expect(storeAt(traversalCtor, i)).toHaveLength(1);
      expect(storeAt(traversalCtor, i)[0]).toMatchObject({ code: 'E11.9' });
    }
    // One store for the whole run — assembly is pathway-independent.
    expect(mockedAssemble).toHaveBeenCalledTimes(1);
    expect(storeAt(traversalCtor, 1)).toBe(storeAt(traversalCtor, 0));
  });

  it('overrideNode re-assembles rather than passing an empty store', async () => {
    mockedGetSession.mockResolvedValue(sessionWith({ temporalContext: CLOCK_V1 }) as never);

    await resolutionMutations.overrideNode(
      undefined,
      { sessionId: 'session-1', nodeId: 'node-1', action: OverrideAction.EXCLUDE, reason: 'r' },
      gqlContext('v1'),
    );

    expect(retraversalCtor).toHaveBeenCalledTimes(1);
    expect(storeAt(retraversalCtor)).toHaveLength(1);
    expect(storeAt(retraversalCtor)[0]).toMatchObject({ kind: 'condition', code: 'E11.9' });
  });

  it('answerPendingDecision re-assembles rather than passing an empty store', async () => {
    mockedGetSession.mockResolvedValue(
      sessionWith({
        temporalContext: CLOCK_V1,
        resolutionState: new Map([
          ['gate-1', { nodeId: 'gate-1', nodeType: 'Gate', title: 'g1', status: NodeStatus.PENDING_QUESTION, confidence: 0, confidenceBreakdown: [], depth: 1 }],
        ]),
      }) as never,
    );

    await resolutionMutations.answerPendingDecision(
      undefined,
      { sessionId: 'session-1', nodeId: 'gate-1', answer: { booleanValue: true } },
      gqlContext('v1'),
    );

    expect(retraversalCtor).toHaveBeenCalledTimes(1);
    expect(storeAt(retraversalCtor)).toHaveLength(1);
  });

  it('addPatientContext re-assembles including the newly supplied facts', async () => {
    mockedGetSession.mockResolvedValue(sessionWith({ temporalContext: CLOCK_V1 }) as never);

    await resolutionMutations.addPatientContext(
      undefined,
      {
        sessionId: 'session-1',
        additionalContext: {
          labResults: [
            { code: '718-7', system: 'LOINC', value: 9.1, date: '2026-01-10' },
          ],
        },
      },
      gqlContext('v1'),
    );

    expect(retraversalCtor).toHaveBeenCalledTimes(1);
    const store = storeAt(retraversalCtor);
    // The initial condition AND the addition — a stale store would hold only
    // the first, an empty one neither. This is the P1-2 bug at the wiring level;
    // its behavioral proof is in v1-traversal-behavior.test.ts.
    expect(store.map((f) => f.code).sort()).toEqual(['718-7', 'E11.9']);
  });

  it('a v1 session created with no encounterStart still assembles vitals facts', async () => {
    // Vitals are pinned to ENCOUNTER under v1, but ASSEMBLY does not need an
    // anchor — only SELECTION does. An assembler that demanded one would make
    // every anchor-less v1 session unstartable.
    await resolutionMutations.startResolution(
      null as never,
      {
        pathwayId: 'pw-1',
        patientId: 'pt-1',
        patientContext: { ...PAYLOAD, vitalSigns: { systolic_bp: 148 } },
      } as never,
      gqlContext('v1'),
    );

    const store = storeAt(traversalCtor);
    expect(store.map((f) => f.kind).sort()).toEqual(['condition', 'vital']);
  });
});

// ─────────────────────────────────────────────────────────────────────

/**
 * D10 — BOTH DOORS RUN THE SAME TRUST PARSING.
 *
 * *These three tests were INVERTED by D10.* Task 9 wrote them to pin the gap
 * R13-1 found: `addPatientContext` ran no trust parsing at all, so `endDate` /
 * `clinicalState` / `recordValidity` / `sourceId` — which `parseResolutionInput`
 * refuses outright in implicit mode and admits only to an ADMIN in explicit
 * SYNTHETIC (`firstTrustAssertion`, trust-mode.ts) — were authorable mid-session
 * by any caller, and under `v1` they govern selection. They now assert the
 * settled rule instead of the gap; they are inverted rather than deleted so the
 * before/after is visible in one place.
 *
 * NOT a security fix, and it must not be described as one: under AD-1 `userRole`
 * comes from an unverified header defaulting to PROVIDER, so a role check
 * secures nothing. The defect is that the SAME request was accepted or refused
 * depending on which mutation carried it — locked decision #7's shape one layer
 * up, two doors into one primitive that did not agree.
 */
describe('addPatientContext runs the same trust parsing as startResolution (D10)', () => {
  it('refuses a caller-asserted recordValidity under v1', async () => {
    // D10 inverted this. It previously asserted the fact reached the store
    // carrying `validityBasis: 'SYNTHETIC_ASSERTION'`, i.e. that a caller
    // refused this at session creation could suppress a fact from evaluation
    // mid-session.
    mockedGetSession.mockResolvedValue(sessionWith({ temporalContext: CLOCK_V1 }) as never);

    await expect(
      resolutionMutations.addPatientContext(
        undefined,
        {
          sessionId: 'session-1',
          additionalContext: {
            labResults: [
              {
                code: '718-7',
                system: 'LOINC',
                value: 9.1,
                date: '2026-01-10',
                recordValidity: 'INVALID',
              } as never,
            ],
          },
        },
        gqlContext('v1'),
      ),
    ).rejects.toThrow(/labResults\[0\]\.recordValidity is a SYNTHETIC assertion/);

    // Refused at the boundary: no retraversal was even constructed, so nothing
    // downstream had a chance to read the assertion.
    expect(retraversalCtor).not.toHaveBeenCalled();
  });

  it('refuses a caller-asserted clinicalState on a coded entry under v1', async () => {
    mockedGetSession.mockResolvedValue(sessionWith({ temporalContext: CLOCK_V1 }) as never);

    await expect(
      resolutionMutations.addPatientContext(
        undefined,
        {
          sessionId: 'session-1',
          additionalContext: {
            conditionCodes: [
              { code: 'E11.9', system: 'ICD-10', clinicalState: 'INACTIVE' } as never,
            ],
          },
        },
        gqlContext('v1'),
      ),
    ).rejects.toThrow(/conditionCodes\[0\]\.clinicalState is a SYNTHETIC assertion/);
  });

  it('is refused on the same request through startResolution', async () => {
    // The agreement itself, asserted rather than described: identical field,
    // identical caller, and now the same answer whichever entry point carries
    // it. The message differs — two error protocols over one predicate, the
    // shape D9 used — but the RULE does not.
    await expect(
      resolutionMutations.startResolution(
        null as never,
        {
          pathwayId: 'pw-1',
          patientId: 'pt-1',
          patientContext: {
            ...PAYLOAD,
            labResults: [
              { code: '718-7', system: 'LOINC', value: 9.1, recordValidity: 'INVALID' },
            ],
          },
        } as never,
        gqlContext('v1'),
      ),
    ).rejects.toThrow(/is a SYNTHETIC assertion and requires resolutionMode: SYNTHETIC/);
  });

  it('refuses it under legacy-v0 too — one rule, not a v1-only one', async () => {
    // D10 inverted this. It previously asserted the addition was accepted and
    // simply inert (empty store, assembler never called), which documented the
    // gap as a `v1` delta. The trust rule is version-INDEPENDENT at
    // `startResolution` — `parseResolutionInput` runs before the version is
    // even resolved — so making the second door `v1`-only would leave the two
    // doors still disagreeing under `legacy-v0`.
    //
    // This is a `legacy-v0` boundary move, and the only one this plan makes. It
    // is confined to requests carrying one of the four assertion fields:
    // nothing calls `addPatientContext` today (verified), and a `legacy-v0`
    // addition WITHOUT them still runs and still gets an empty store — pinned
    // by `passes an empty fact store on every retraversal entry point under
    // legacy-v0` above, which sends the same lab with no assertion field.
    mockedGetSession.mockResolvedValue(sessionWith() as never);

    await expect(
      resolutionMutations.addPatientContext(
        undefined,
        {
          sessionId: 'session-1',
          additionalContext: {
            labResults: [
              { code: '718-7', system: 'LOINC', value: 9.1, recordValidity: 'INVALID' } as never,
            ],
          },
        },
        gqlContext(),
      ),
    ).rejects.toThrow(/labResults\[0\]\.recordValidity is a SYNTHETIC assertion/);

    expect(mockedAssemble).not.toHaveBeenCalled();
  });

  it('admits an explicitly-null assertion field, exactly as omission (both doors)', async () => {
    // The predicate keys on `!= null` so a client binding an unset form field
    // sends the same request as one that omits it. Both doors share the
    // predicate, so neither can disagree about null.
    mockedGetSession.mockResolvedValue(sessionWith({ temporalContext: CLOCK_V1 }) as never);

    await resolutionMutations.addPatientContext(
      undefined,
      {
        sessionId: 'session-1',
        additionalContext: {
          labResults: [
            {
              code: '718-7',
              system: 'LOINC',
              value: 9.1,
              date: '2026-01-10',
              recordValidity: null,
              sourceId: null,
            } as never,
          ],
        },
      },
      gqlContext('v1'),
    );

    const lab = storeAt(retraversalCtor).find((f) => f.code === '718-7')!;
    expect(lab.validityBasis).not.toBe('SYNTHETIC_ASSERTION');
  });

  it('leaves a fact already stored on the session untouched', async () => {
    // The guard reads the NEWLY supplied payload, never the merged bag. A
    // session whose stored `additionalContext` carries an assertion — put there
    // before this rule existed, or by an authorized path — must not become
    // permanently un-addable-to.
    mockedGetSession.mockResolvedValue(
      sessionWith({
        temporalContext: CLOCK_V1,
        additionalContext: {
          labResults: [
            { code: '4548-4', system: 'LOINC', value: 7.2, date: '2026-01-05', recordValidity: 'INVALID' },
          ],
        },
      }) as never,
    );

    await resolutionMutations.addPatientContext(
      undefined,
      {
        sessionId: 'session-1',
        additionalContext: {
          labResults: [{ code: '718-7', system: 'LOINC', value: 9.1, date: '2026-01-10' }],
        },
      },
      gqlContext('v1'),
    );

    expect(retraversalCtor).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('retraversal reuses the stored clock', () => {
  it('assembles against the session clock, not the wall clock', async () => {
    mockedGetSession.mockResolvedValue(sessionWith({ temporalContext: CLOCK_V1 }) as never);
    jest.useFakeTimers().setSystemTime(new Date('2027-06-01T00:00:00.000Z'));
    try {
      await resolutionMutations.overrideNode(
        undefined,
        { sessionId: 'session-1', nodeId: 'node-1', action: OverrideAction.EXCLUDE, reason: 'r' },
        gqlContext('v1'),
      );
    } finally {
      jest.useRealTimers();
    }

    // An OPEN-ended stateful fact is asserted current AT the pinned instant. A
    // freshly stamped clock would put 2027 here.
    expect(storeAt(retraversalCtor)[0]).toMatchObject({ stateAsOf: PINNED });
    expect(retraversalCtor.mock.calls[0][2]).toBe(CLOCK_V1);
  });

  it('resolves the same factIds on re-run as at creation', async () => {
    // Facts are not persisted (plan 05b), so every entry point re-assembles.
    // Plan 05 decision 5 makes that sound only if identical input yields
    // identical factIds.
    await resolutionMutations.startResolution(
      null as never,
      { pathwayId: 'pw-1', patientId: 'pt-1', patientContext: PAYLOAD } as never,
      gqlContext('v1'),
    );
    const atCreation = storeAt(traversalCtor).map((f) => f.factId);

    mockedGetSession.mockResolvedValue(sessionWith({ temporalContext: CLOCK_V1 }) as never);
    await resolutionMutations.overrideNode(
      undefined,
      { sessionId: 'session-1', nodeId: 'node-1', action: OverrideAction.EXCLUDE, reason: 'r' },
      gqlContext('v1'),
    );
    const atRetraversal = storeAt(retraversalCtor).map((f) => f.factId);

    expect(atRetraversal).toEqual(atCreation);
  });
});

// ─────────────────────────────────────────────────────────────────────

describe('the policy selector is request-scoped and server-side (P2-12, P1-14, P1-19)', () => {
  it('defaults to v1 when the deployment sets nothing', async () => {
    await resolutionMutations.startResolution(
      null as never,
      { pathwayId: 'pw-1', patientId: 'pt-1', patientContext: PAYLOAD } as never,
      gqlContext(),
    );
    expect(persistedVersionOf(mockedCreateSession as unknown as jest.Mock)).toBe('v1');
  });

  it('stamps the INJECTED version on the zero-match path', async () => {
    mockedGetMatched.mockResolvedValue([]);

    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      null as never,
      { patientId: 'pt-1', patientContext: PAYLOAD } as never,
      gqlContext('legacy-v0'),
    );

    // Asserting legacy-v0, not v1: the injected version must DIFFER from
    // DEFAULT_TEMPORAL_POLICY_VERSION or this test passes whether or not the
    // selector ran at all. That constant used to be legacy-v0 and this test
    // injected v1 for exactly this reason; the default is now v1, so the roles
    // swap. The property being guarded is unchanged — injection beats default.
    expect(persistedVersionOf(mockedCreateMp as unknown as jest.Mock)).toBe('legacy-v0');
  });

  it('gives every child session the injected version, not merely equal ones', async () => {
    mockedGetMatched.mockResolvedValue([
      matchedPathway('pw-1'),
      matchedPathway('pw-2'),
      matchedPathway('pw-3'),
    ] as never);

    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      null as never,
      { patientId: 'pt-1', patientContext: PAYLOAD } as never,
      gqlContext('v1'),
    );

    const spy = mockedCreateSession as unknown as jest.Mock;
    const versions = spy.mock.calls.map((_c, i) => persistedVersionOf(spy, i));
    expect(versions).toHaveLength(3);
    expect(versions.every((v) => v === 'v1')).toBe(true);
    // And the parent carries it too.
    expect(persistedVersionOf(mockedCreateMp as unknown as jest.Mock)).toBe('v1');
  });

  it('is not selectable from either start mutation’s arguments', () => {
    // Narrowed from a whole-SDL regex (P2-17): that would also forbid the
    // read-only OUTPUT field design §606 plans for plan 08.
    const sdl = parse(readFileSync(join(__dirname, '../../../schema.graphql'), 'utf-8'));
    const argumentNamesOf = (mutation: string): string[] => {
      for (const def of sdl.definitions) {
        if (
          def.kind !== Kind.OBJECT_TYPE_DEFINITION &&
          def.kind !== Kind.OBJECT_TYPE_EXTENSION
        ) {
          continue;
        }
        if (def.name.value !== 'Mutation') continue;
        for (const field of def.fields ?? []) {
          if (field.name.value === mutation) {
            return (field.arguments ?? []).map((a) => a.name.value);
          }
        }
      }
      throw new Error(`Mutation.${mutation} not found in schema.graphql`);
    };

    for (const m of ['startResolution', 'startMultiPathwayResolution']) {
      const args = argumentNamesOf(m);
      // The lookup itself must be load-bearing: a typo'd mutation name would
      // otherwise make `not.toContain` vacuously true.
      expect(args).toContain('patientId');
      expect(args).not.toContain('temporalPolicyVersion');
    }
  });

  it('ignores a temporalPolicyVersion supplied on the request', async () => {
    await resolutionMutations.startResolution(
      null as never,
      {
        pathwayId: 'pw-1',
        patientId: 'pt-1',
        patientContext: PAYLOAD,
        // Must differ from DEFAULT_TEMPORAL_POLICY_VERSION, or "the request was
        // ignored" and "the request was honoured" produce the same result. The
        // default moved from legacy-v0 to v1, so the request now asks for
        // legacy-v0; the property under test — server-owned beats
        // client-supplied — is unchanged.
        temporalPolicyVersion: 'legacy-v0',
      } as never,
      gqlContext(),
    );

    expect(persistedVersionOf(mockedCreateSession as unknown as jest.Mock)).toBe('v1');
    // Corollary: the server's v1 really took effect, so the assembler ran —
    // it would not have under the legacy-v0 the request asked for.
    expect(mockedAssemble).toHaveBeenCalled();
  });

  it('ignores a temporalPolicyVersion supplied on the multi-pathway request', async () => {
    mockedGetMatched.mockResolvedValue([]);

    await multiPathwayResolutionMutations.startMultiPathwayResolution(
      null as never,
      // Same inversion as the single-pathway sibling above: the request asks
      // for the NON-default so that being ignored is observable.
      { patientId: 'pt-1', patientContext: PAYLOAD, temporalPolicyVersion: 'legacy-v0' } as never,
      gqlContext(),
    );

    expect(persistedVersionOf(mockedCreateMp as unknown as jest.Mock)).toBe('v1');
  });

  it('refuses a deployment configured with an unknown version', async () => {
    await expect(
      resolutionMutations.startResolution(
        null as never,
        { pathwayId: 'pw-1', patientId: 'pt-1', patientContext: PAYLOAD } as never,
        gqlContext('v99'),
      ),
    ).rejects.toThrow(/unknown temporalPolicyVersion/);
  });

  it('refuses an unknown version on the multi-pathway zero-match path too', async () => {
    mockedGetMatched.mockResolvedValue([]);
    await expect(
      multiPathwayResolutionMutations.startMultiPathwayResolution(
        null as never,
        { patientId: 'pt-1', patientContext: PAYLOAD } as never,
        gqlContext('v99'),
      ),
    ).rejects.toThrow(/unknown temporalPolicyVersion/);
  });
});
