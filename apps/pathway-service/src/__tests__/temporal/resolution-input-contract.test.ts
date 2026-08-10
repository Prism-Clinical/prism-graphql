/**
 * The input contract: an explicit trust mode, temporal anchors that actually
 * reach the guard, and SDL fields that are all optional so today's callers
 * keep working.
 *
 * The mock set mirrors retraversal-clock-reuse.test.ts. `jest.mock` with a
 * factory replaces the WHOLE module, so any export the resolver imports and
 * the factory omits is `undefined` at call time. resolution-context is
 * deliberately spread from requireActual: `assertEncounterAnchor` must stay
 * REAL, or the anchor tests below would pass against a stub and prove nothing.
 */

const mockTraverse = jest.fn();
const traversalCtor = jest.fn();

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
  },
}));

jest.mock('../../services/resolution/session-store', () => ({
  createSession: jest.fn().mockResolvedValue('session-1'),
  getSession: jest.fn().mockResolvedValue({ id: 'session-1' }),
  updateSession: jest.fn().mockResolvedValue(undefined),
  logEvent: jest.fn().mockResolvedValue(undefined),
  logNodeOverride: jest.fn().mockResolvedValue(undefined),
  logGateAnswer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../services/medications/ddi-pass-single-pathway', () => ({
  applyDdiToResolutionState: jest.fn().mockResolvedValue({ findings: [] }),
}));

const mockBuildResolutionContext = jest.fn();
jest.mock('../../resolvers/helpers/resolution-context', () => ({
  ...jest.requireActual('../../resolvers/helpers/resolution-context'),
  buildResolutionContext: (...a: unknown[]) => mockBuildResolutionContext(...a),
  makeTraversalAdapter: jest.fn(() => ({ computeNodeConfidence: jest.fn() })),
  makeRetraversalAdapter: jest.fn(() => ({ computeNodeConfidence: jest.fn() })),
  makeLlmGateEvaluator: jest.fn(() => null),
}));

import * as fs from 'fs';
import * as path from 'path';
import { parse, DocumentNode, ObjectTypeDefinitionNode, InputObjectTypeDefinitionNode, EnumTypeDefinitionNode } from 'graphql';
import { resolutionMutations } from '../../resolvers/mutations/resolution';
import {
  parseResolutionInput,
  RawPatientContextInput,
} from '../../services/resolution/temporal/trust-mode';
import { TemporalContextError } from '../../services/resolution/temporal/evaluation-context';
import { GraphNode } from '../../services/confidence/types';
import { GateType } from '../../services/resolution/types';

// ─── SDL ──────────────────────────────────────────────────────────────

const SDL: DocumentNode = parse(
  fs.readFileSync(path.join(__dirname, '../../../schema.graphql'), 'utf-8'),
);

const inputType = (name: string): InputObjectTypeDefinitionNode => {
  const d = SDL.definitions.find(
    (x) => x.kind === 'InputObjectTypeDefinition' && x.name.value === name,
  );
  if (!d) throw new Error(`no input type ${name}`);
  return d as InputObjectTypeDefinitionNode;
};

const enumType = (name: string): EnumTypeDefinitionNode => {
  const d = SDL.definitions.find(
    (x) => x.kind === 'EnumTypeDefinition' && x.name.value === name,
  );
  if (!d) throw new Error(`no enum ${name}`);
  return d as EnumTypeDefinitionNode;
};

const mutationField = (name: string) => {
  const m = SDL.definitions.find(
    (x) => x.kind === 'ObjectTypeDefinition' && x.name.value === 'Mutation',
  ) as ObjectTypeDefinitionNode;
  const f = m.fields?.find((x) => x.name.value === name);
  if (!f) throw new Error(`no mutation ${name}`);
  return f;
};

const argNames = (name: string) => mutationField(name).arguments?.map((a) => a.name.value) ?? [];
const fieldNames = (t: InputObjectTypeDefinitionNode) => t.fields?.map((f) => f.name.value) ?? [];

describe('SDL — the resolution input surface', () => {
  it('declares the three mode enums', () => {
    expect(enumType('ResolutionModeInput').values?.map((v) => v.name.value)).toEqual([
      'LIVE',
      'SYNTHETIC',
      'REPLAY',
    ]);
    expect(enumType('ClinicalStateInput').values?.map((v) => v.name.value)).toEqual([
      'ACTIVE',
      'INACTIVE',
      'ON_HOLD',
      'UNKNOWN',
      'CONFLICT',
    ]);
    expect(enumType('RecordValidityInput').values?.map((v) => v.name.value)).toEqual([
      'VALID',
      'INVALID',
      'UNKNOWN',
    ]);
  });

  it.each(['startResolution', 'startMultiPathwayResolution'])(
    '%s takes a mode, both payload ids and both temporal anchors',
    (mutation) => {
      const args = argNames(mutation);
      for (const a of [
        'resolutionMode',
        'snapshotId',
        'sessionId',
        'evaluationAsOf',
        'encounterStart',
      ]) {
        expect(args).toContain(a);
      }
    },
  );

  it.each(['startResolution', 'startMultiPathwayResolution'])(
    'every new %s argument is optional, so existing callers still compile',
    (mutation) => {
      const added = new Set([
        'resolutionMode',
        'snapshotId',
        'sessionId',
        'evaluationAsOf',
        'encounterStart',
      ]);
      for (const a of mutationField(mutation).arguments ?? []) {
        if (added.has(a.name.value)) expect(a.type.kind).not.toBe('NonNullType');
      }
    },
  );

  it('exposes the synthetic fields on CodeInput', () => {
    const names = fieldNames(inputType('CodeInput'));
    for (const f of ['date', 'endDate', 'clinicalState', 'recordValidity', 'sourceId']) {
      expect(names).toContain(f);
    }
  });

  it('gives LabResultInput validity and source but NOT clinicalState', () => {
    const names = fieldNames(inputType('LabResultInput'));
    expect(names).toContain('recordValidity');
    expect(names).toContain('sourceId');
    expect(names).not.toContain('clinicalState');
  });

  it('types the synthetic enums rather than taking free strings', () => {
    const code = inputType('CodeInput');
    const typeOf = (f: string) => {
      const node = code.fields?.find((x) => x.name.value === f);
      return node && node.type.kind === 'NamedType' ? node.type.name.value : undefined;
    };
    expect(typeOf('clinicalState')).toBe('ClinicalStateInput');
    expect(typeOf('recordValidity')).toBe('RecordValidityInput');
  });

  it('keeps every new input field optional', () => {
    for (const t of ['CodeInput', 'LabResultInput']) {
      for (const f of inputType(t).fields ?? []) {
        if (['code', 'system'].includes(f.name.value)) continue;
        expect(f.type.kind).not.toBe('NonNullType');
      }
    }
  });
});

describe('SDL — saved scenarios mirror the inputs they persist', () => {
  // A scenario is stored as raw JSONB, so the mutation already persists every
  // field. But a field missing from the OUTPUT type cannot be read back, and
  // the simulator's load-edit-save cycle then writes the truncated version
  // over the original — silent data loss on a round trip. A drift test rather
  // than a field list, so the next input field is caught automatically.
  const objectType = (name: string): ObjectTypeDefinitionNode => {
    const d = SDL.definitions.find(
      (x) => x.kind === 'ObjectTypeDefinition' && x.name.value === name,
    );
    if (!d) throw new Error(`no type ${name}`);
    return d as ObjectTypeDefinitionNode;
  };

  it.each([
    ['CodeInput', 'SimulatorScenarioCode', [] as string[]],
    // Observations carry no clinical state, so the lab mirror must not gain one.
    ['LabResultInput', 'SimulatorScenarioLabResult', ['clinicalState']],
  ])('%s round-trips through %s', (input, output, exempt) => {
    const outFields = new Set(
      objectType(output).fields?.map((f) => f.name.value) ?? [],
    );
    for (const f of fieldNames(inputType(input))) {
      if (exempt.includes(f)) continue;
      expect(outFields).toContain(f);
    }
  });

  it('does not put clinicalState on the lab mirror', () => {
    const outFields = objectType('SimulatorScenarioLabResult').fields?.map((f) => f.name.value);
    expect(outFields).not.toContain('clinicalState');
  });
});

// ─── parseResolutionInput ─────────────────────────────────────────────

/** Only the fields a caller could already send before this feature existed. */
const legacyPc = (): RawPatientContextInput => ({
  conditionCodes: [{ code: 'E11.9', system: 'icd10' }],
  medications: [],
  labResults: [],
  allergies: [],
});

describe('parseResolutionInput — exactly one payload per mode', () => {
  it('defaults to SYNTHETIC when no mode is given, preserving existing callers', () => {
    const input = parseResolutionInput({ patientContext: legacyPc() }, 'p1', 'PROVIDER');
    expect(input.mode).toBe('SYNTHETIC');
  });

  it('does NOT demand ADMIN for the defaulted mode — that would break every caller', () => {
    expect(() =>
      parseResolutionInput({ patientContext: legacyPc() }, 'p1', 'PROVIDER'),
    ).not.toThrow();
  });

  it('works with no patientContext at all, as startResolution has always allowed', () => {
    expect(parseResolutionInput({}, 'p1', 'PROVIDER').mode).toBe('SYNTHETIC');
  });

  it('stamps the patientId from the mutation argument onto the variant', () => {
    const input = parseResolutionInput({ patientContext: legacyPc() }, 'pt-42', 'PROVIDER');
    expect(input.mode === 'SYNTHETIC' && input.patientContext.patientId).toBe('pt-42');
  });

  it('demands ADMIN when SYNTHETIC is selected explicitly', () => {
    expect(() =>
      parseResolutionInput(
        { resolutionMode: 'SYNTHETIC', patientContext: legacyPc() },
        'p1',
        'PROVIDER',
      ),
    ).toThrow(TemporalContextError);
    expect(() =>
      parseResolutionInput(
        { resolutionMode: 'SYNTHETIC', patientContext: legacyPc() },
        'p1',
        'ADMIN',
      ),
    ).not.toThrow();
  });

  it('requires a patientContext for an explicit SYNTHETIC', () => {
    expect(() => parseResolutionInput({ resolutionMode: 'SYNTHETIC' }, 'p1', 'ADMIN')).toThrow(
      /patientContext/,
    );
  });

  it('rejects a snapshotId alongside SYNTHETIC', () => {
    expect(() =>
      parseResolutionInput(
        { resolutionMode: 'SYNTHETIC', snapshotId: 'snap-1', patientContext: legacyPc() },
        'p1',
        'ADMIN',
      ),
    ).toThrow(/snapshotId/);
  });

  it('requires a snapshotId for LIVE and carries it on the variant', () => {
    expect(() => parseResolutionInput({ resolutionMode: 'LIVE' }, 'p1', 'ADMIN')).toThrow(
      /snapshotId/,
    );
    expect(
      parseResolutionInput({ resolutionMode: 'LIVE', snapshotId: 'snap-1' }, 'p1', 'ADMIN'),
    ).toEqual({ mode: 'LIVE', snapshotId: 'snap-1' });
  });

  it('requires a sessionId for REPLAY', () => {
    expect(() => parseResolutionInput({ resolutionMode: 'REPLAY' }, 'p1', 'ADMIN')).toThrow(
      /sessionId/,
    );
    expect(
      parseResolutionInput({ resolutionMode: 'REPLAY', sessionId: 's-1' }, 'p1', 'ADMIN'),
    ).toEqual({ mode: 'REPLAY', sessionId: 's-1' });
  });

  it('rejects an unknown mode string', () => {
    expect(() => parseResolutionInput({ resolutionMode: 'GUESS' }, 'p1', 'ADMIN')).toThrow(
      TemporalContextError,
    );
  });

  it('rejects a payload id supplied with no mode at all', () => {
    expect(() => parseResolutionInput({ snapshotId: 'snap-1' }, 'p1', 'ADMIN')).toThrow(
      /resolutionMode/,
    );
  });

  it('uses the resolution-input error code throughout', () => {
    try {
      parseResolutionInput({ resolutionMode: 'LIVE' }, 'p1', 'ADMIN');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as TemporalContextError).code).toBe('INVALID_RESOLUTION_INPUT');
    }
  });
});

describe('parseResolutionInput — LIVE and REPLAY cannot smuggle a payload', () => {
  // The union guarantees this in the type, but a caller reaches the parser
  // through untyped GraphQL args. Before this, the parser never saw
  // patientContext at all, so the guarantee stopped at the boundary — and
  // would have reopened the moment LIVE stopped throwing.
  it('rejects clinical facts sent with LIVE', () => {
    expect(() =>
      parseResolutionInput(
        { resolutionMode: 'LIVE', snapshotId: 'snap-1', patientContext: legacyPc() },
        'p1',
        'ADMIN',
      ),
    ).toThrow(/patientContext/);
  });

  it('rejects clinical facts sent with REPLAY', () => {
    expect(() =>
      parseResolutionInput(
        { resolutionMode: 'REPLAY', sessionId: 's-1', patientContext: legacyPc() },
        'p1',
        'ADMIN',
      ),
    ).toThrow(/patientContext/);
  });

  it('rejects a caller-pinned clock on LIVE', () => {
    expect(() =>
      parseResolutionInput(
        { resolutionMode: 'LIVE', snapshotId: 'snap-1', evaluationAsOf: '2020-01-01T00:00:00.000Z' },
        'p1',
        'ADMIN',
      ),
    ).toThrow(/evaluationAsOf/);
  });

  it('rejects both anchors on REPLAY, which must reuse the recorded clock', () => {
    expect(() =>
      parseResolutionInput(
        { resolutionMode: 'REPLAY', sessionId: 's-1', evaluationAsOf: '2020-01-01T00:00:00.000Z' },
        'p1',
        'ADMIN',
      ),
    ).toThrow(/evaluationAsOf/);
    expect(() =>
      parseResolutionInput(
        { resolutionMode: 'REPLAY', sessionId: 's-1', encounterStart: '2020-01-01T00:00:00.000Z' },
        'p1',
        'ADMIN',
      ),
    ).toThrow(/encounterStart/);
  });

  it('rejects encounterStart on LIVE — design §1 derives it from the encounter', () => {
    // "LIVE mode derives encounterStart from the encounter; SYNTHETIC mode
    // supplies it." A caller-supplied anchor here becomes a clock-spoofing
    // path the moment plan 07 stops throwing.
    expect(() =>
      parseResolutionInput(
        {
          resolutionMode: 'LIVE',
          snapshotId: 'snap-1',
          encounterStart: '2026-06-01T08:00:00.000Z',
        },
        'p1',
        'ADMIN',
      ),
    ).toThrow(/encounterStart/);
  });

  it('keeps encounterStart available on SYNTHETIC, which is the mode providers use', () => {
    expect(() =>
      parseResolutionInput(
        { patientContext: legacyPc(), encounterStart: '2026-06-01T08:00:00.000Z' },
        'p1',
        'PROVIDER',
      ),
    ).not.toThrow();
  });
});

describe('parseResolutionInput — explicit null is omission', () => {
  // The generated resolver types model optionals as InputMaybe<T> — T | null |
  // undefined — but the hand-written ones stopped at undefined. A client that
  // binds an unset form field sends null, which was read as "a value was
  // supplied": counted as a privileged assertion implicitly, and rejected as
  // an invalid enum member explicitly.
  const withNulls = () => ({
    conditionCodes: [
      {
        code: 'c',
        system: 's',
        display: null,
        date: null,
        endDate: null,
        clinicalState: null,
        recordValidity: null,
        sourceId: null,
      },
    ],
    medications: [],
    allergies: [],
    labResults: [{ code: 'l', system: 'loinc', recordValidity: null, sourceId: null }],
  });

  it('does not treat a null assertion as privileged in implicit mode', () => {
    expect(() =>
      parseResolutionInput({ patientContext: withNulls() as never }, 'p1', 'PROVIDER'),
    ).not.toThrow();
  });

  it('strips the nulls so downstream sees omission, not an invalid enum', () => {
    const input = parseResolutionInput({ patientContext: withNulls() as never }, 'p1', 'PROVIDER');
    const entry = input.mode === 'SYNTHETIC' ? input.patientContext.conditionCodes[0] : null;
    expect(entry && 'clinicalState' in entry).toBe(false);
    expect(entry && 'recordValidity' in entry).toBe(false);
    expect(entry && 'endDate' in entry).toBe(false);
  });

  it('produces the same variant as omitting the fields entirely', () => {
    const withNull = parseResolutionInput(
      { patientContext: withNulls() as never },
      'p1',
      'PROVIDER',
    );
    const omitted = parseResolutionInput(
      {
        patientContext: {
          conditionCodes: [{ code: 'c', system: 's' }],
          medications: [],
          allergies: [],
          labResults: [{ code: 'l', system: 'loinc' }],
        },
      },
      'p1',
      'PROVIDER',
    );
    expect(withNull).toEqual(omitted);
  });

  it('treats a null anchor as absent rather than as a pinned clock', () => {
    expect(() =>
      parseResolutionInput(
        { patientContext: legacyPc(), evaluationAsOf: null },
        'p1',
        'PROVIDER',
      ),
    ).not.toThrow();
  });
});

describe('parseResolutionInput — the nested patientId must agree', () => {
  it('rejects a context labelled for a different patient', () => {
    // PatientContextInput.patientId is required by the SDL, and normalization
    // used to ignore it — so a context built for patient B could be stored and
    // evaluated as patient A.
    expect(() =>
      parseResolutionInput(
        { patientContext: { ...legacyPc(), patientId: 'patient-B' } },
        'patient-A',
        'PROVIDER',
      ),
    ).toThrow(/does not match/);
  });

  it('accepts a matching nested patientId, as the simulator sends', () => {
    expect(() =>
      parseResolutionInput(
        { patientContext: { ...legacyPc(), patientId: 'patient-A' } },
        'patient-A',
        'PROVIDER',
      ),
    ).not.toThrow();
  });

  it('accepts an omitted nested patientId', () => {
    expect(() =>
      parseResolutionInput({ patientContext: legacyPc() }, 'patient-A', 'PROVIDER'),
    ).not.toThrow();
  });
});

describe('parseResolutionInput — omitting the mode is not a bypass', () => {
  // Omitting resolutionMode used to return before assertSyntheticAuthorized,
  // so a PROVIDER could assert clinical truth and pin the clock with a
  // one-word omission. Real authentication would not have closed that.
  it.each([
    ['clinicalState', { conditionCodes: [{ code: 'c', system: 's', clinicalState: 'ACTIVE' }] }],
    ['recordValidity', { conditionCodes: [{ code: 'c', system: 's', recordValidity: 'VALID' }] }],
    ['endDate', { medications: [{ code: 'm', system: 's', endDate: '2026-01-01' }] }],
    ['sourceId', { allergies: [{ code: 'a', system: 's', sourceId: 'x' }] }],
    ['a lab recordValidity', { labResults: [{ code: 'l', system: 's', recordValidity: 'INVALID' }] }],
    ['a lab sourceId', { labResults: [{ code: 'l', system: 's', sourceId: 'x' }] }],
  ])('refuses %s without an explicit SYNTHETIC mode', (_label, over) => {
    expect(() =>
      parseResolutionInput({ patientContext: { ...legacyPc(), ...over } }, 'p1', 'PROVIDER'),
    ).toThrow(/SYNTHETIC/);
  });

  it('refuses a caller-pinned clock without an explicit SYNTHETIC mode', () => {
    expect(() =>
      parseResolutionInput(
        { patientContext: legacyPc(), evaluationAsOf: '2020-01-01T00:00:00.000Z' },
        'p1',
        'PROVIDER',
      ),
    ).toThrow(/evaluationAsOf/);
  });

  it('names the offending field path so the caller can find it', () => {
    expect(() =>
      parseResolutionInput(
        {
          patientContext: {
            ...legacyPc(),
            medications: [
              { code: 'm0', system: 's' },
              { code: 'm1', system: 's', clinicalState: 'ON_HOLD' },
            ],
          },
        },
        'p1',
        'PROVIDER',
      ),
    ).toThrow(/medications\[1\]\.clinicalState/);
  });

  it('STILL allows an authorized caller to send the same assertions explicitly', () => {
    expect(() =>
      parseResolutionInput(
        {
          resolutionMode: 'SYNTHETIC',
          patientContext: {
            ...legacyPc(),
            conditionCodes: [{ code: 'c', system: 's', clinicalState: 'INACTIVE' }],
          },
          evaluationAsOf: '2020-01-01T00:00:00.000Z',
        },
        'p1',
        'ADMIN',
      ),
    ).not.toThrow();
  });

  it('leaves the legacy field set alone — code, system, display, date all pass', () => {
    expect(() =>
      parseResolutionInput(
        {
          patientContext: {
            ...legacyPc(),
            conditionCodes: [
              { code: 'c', system: 's', display: 'C', date: '2026-01-01' },
            ],
            labResults: [{ code: 'l', system: 'loinc', value: 1, unit: '%', date: '2026-01-01' }],
          },
          encounterStart: '2026-06-01T08:00:00.000Z',
        },
        'p1',
        'PROVIDER',
      ),
    ).not.toThrow();
  });
});

// ─── The resolver: anchors reach the guard ────────────────────────────

const ENCOUNTER_GATE: GraphNode = {
  id: 'g-1',
  nodeIdentifier: 'g-1',
  nodeType: 'Gate',
  properties: {
    title: 'g-1',
    // `gate_type` is load-bearing, not decoration: sweepableConditions only
    // collects conditions for the gate types that actually evaluate them, so
    // without it this gate is skipped and the guard never fires.
    gate_type: GateType.PATIENT_ATTRIBUTE,
    // A NODE-level ENCOUNTER horizon requires an anchor under ANY policy
    // version, so this probes the guard without needing a v1 selector — there
    // is no SDL input for the policy version yet.
    condition: { field: 'labs', operator: 'exists', value: '718-7', horizon: 'ENCOUNTER' },
  },
} as GraphNode;

/** A graph with no temporal requirements — the resolver rejects an empty one. */
const PLAIN_NODE: GraphNode = {
  id: 's-1',
  nodeIdentifier: 's-1',
  nodeType: 'Step',
  properties: { title: 's-1' },
} as GraphNode;

function rctxWith(nodes: GraphNode[]) {
  return {
    graphContext: {
      allNodes: nodes,
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

const poolStub = {
  query: jest.fn().mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] }),
};

const gqlContext = (userRole = 'PROVIDER') =>
  ({ pool: poolStub, redis: {}, userId: 'u-1', userRole }) as never;

const start = (args: Record<string, unknown>, userRole = 'PROVIDER') =>
  resolutionMutations.startResolution(
    null,
    { pathwayId: 'pw-1', patientId: 'pt-1', ...args } as never,
    gqlContext(userRole),
  );

describe('startResolution — temporal anchors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    poolStub.query.mockResolvedValue({ rows: [{ id: 'pw-1', version: 1, status: 'ACTIVE' }] });
    mockTraverse.mockResolvedValue({
      resolutionState: {},
      dependencyMap: {},
      pendingQuestions: [],
      redFlags: [],
      totalNodesEvaluated: 1,
      traversalDurationMs: 1,
      isDegraded: false,
    });
    mockBuildResolutionContext.mockResolvedValue(rctxWith([ENCOUNTER_GATE]));
  });

  const capturedTemporalContext = () => traversalCtor.mock.calls[0][2];

  it('threads a supplied evaluationAsOf into the session clock', async () => {
    // A pinned clock is an ADMIN-only assertion, so this goes through the
    // explicit SYNTHETIC path.
    mockBuildResolutionContext.mockResolvedValue(rctxWith([PLAIN_NODE]));
    await start(
      {
        resolutionMode: 'SYNTHETIC',
        patientContext: { conditionCodes: [], medications: [], labResults: [], allergies: [] },
        evaluationAsOf: '2026-03-04T05:06:07.000Z',
      },
      'ADMIN',
    );
    expect(capturedTemporalContext().evaluationAsOf).toBe('2026-03-04T05:06:07.000Z');
  });

  it('rejects an empty evaluationAsOf instead of silently using the wall clock', async () => {
    mockBuildResolutionContext.mockResolvedValue(rctxWith([PLAIN_NODE]));
    await expect(
      start(
        {
          resolutionMode: 'SYNTHETIC',
          patientContext: { conditionCodes: [], medications: [], labResults: [], allergies: [] },
          evaluationAsOf: '',
        },
        'ADMIN',
      ),
    ).rejects.toThrow(/evaluationAsOf/);
  });

  it('still reads the wall clock when no evaluationAsOf is given', async () => {
    mockBuildResolutionContext.mockResolvedValue(rctxWith([PLAIN_NODE]));
    await start({});
    expect(capturedTemporalContext().evaluationAsOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('fails with MISSING_ENCOUNTER_ANCHOR when the pathway needs an anchor and none is given', async () => {
    await expect(start({})).rejects.toThrow(/encounterStart/);
    expect(traversalCtor).not.toHaveBeenCalled();
  });

  it('starts once encounterStart is supplied, and pins it on the clock', async () => {
    // Deliberately a PROVIDER with no explicit mode: encounterStart is the one
    // anchor an ordinary caller must be able to send, because without it a
    // pathway with an ENCOUNTER horizon is unstartable.
    await start({ encounterStart: '2026-03-04T04:00:00.000Z' });
    expect(capturedTemporalContext().encounterStart).toBe('2026-03-04T04:00:00.000Z');
  });

  it('rejects an explicit SYNTHETIC mode from a non-admin before doing any work', async () => {
    mockBuildResolutionContext.mockResolvedValue(rctxWith([PLAIN_NODE]));
    await expect(start({ resolutionMode: 'SYNTHETIC' }, 'PROVIDER')).rejects.toThrow(/ADMIN/);
  });

  it('refuses LIVE, naming the plan that will implement it', async () => {
    mockBuildResolutionContext.mockResolvedValue(rctxWith([PLAIN_NODE]));
    await expect(
      start({ resolutionMode: 'LIVE', snapshotId: 'snap-1' }, 'ADMIN'),
    ).rejects.toThrow(/plan 07/);
  });

  it('refuses REPLAY, naming the plan that will implement it', async () => {
    mockBuildResolutionContext.mockResolvedValue(rctxWith([PLAIN_NODE]));
    await expect(start({ resolutionMode: 'REPLAY', sessionId: 's-1' }, 'ADMIN')).rejects.toThrow(
      /plan 05b/,
    );
  });

  it('still serves a caller that sends no mode at all', async () => {
    mockBuildResolutionContext.mockResolvedValue(rctxWith([PLAIN_NODE]));
    await expect(start({})).resolves.toBeDefined();
  });
});
