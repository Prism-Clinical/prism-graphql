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
  SyntheticPatientContext,
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

// ─── parseResolutionInput ─────────────────────────────────────────────

const emptyPc = (): SyntheticPatientContext => ({
  patientId: 'p1',
  conditionCodes: [],
  medications: [],
  labResults: [],
  allergies: [],
});

describe('parseResolutionInput — exactly one payload per mode', () => {
  it('defaults to SYNTHETIC when no mode is given, preserving existing callers', () => {
    const input = parseResolutionInput({}, emptyPc(), 'PROVIDER');
    expect(input.mode).toBe('SYNTHETIC');
  });

  it('does NOT demand ADMIN for the defaulted mode — that would break every caller', () => {
    expect(() => parseResolutionInput({}, emptyPc(), 'PROVIDER')).not.toThrow();
  });

  it('demands ADMIN when SYNTHETIC is selected explicitly', () => {
    expect(() =>
      parseResolutionInput({ resolutionMode: 'SYNTHETIC' }, emptyPc(), 'PROVIDER'),
    ).toThrow(TemporalContextError);
    expect(() =>
      parseResolutionInput({ resolutionMode: 'SYNTHETIC' }, emptyPc(), 'ADMIN'),
    ).not.toThrow();
  });

  it('rejects a snapshotId alongside SYNTHETIC', () => {
    expect(() =>
      parseResolutionInput(
        { resolutionMode: 'SYNTHETIC', snapshotId: 'snap-1' },
        emptyPc(),
        'ADMIN',
      ),
    ).toThrow(/snapshotId/);
  });

  it('requires a snapshotId for LIVE and carries it on the variant', () => {
    expect(() => parseResolutionInput({ resolutionMode: 'LIVE' }, emptyPc(), 'ADMIN')).toThrow(
      /snapshotId/,
    );
    const input = parseResolutionInput(
      { resolutionMode: 'LIVE', snapshotId: 'snap-1' },
      emptyPc(),
      'ADMIN',
    );
    expect(input).toEqual({ mode: 'LIVE', snapshotId: 'snap-1' });
  });

  it('requires a sessionId for REPLAY', () => {
    expect(() => parseResolutionInput({ resolutionMode: 'REPLAY' }, emptyPc(), 'ADMIN')).toThrow(
      /sessionId/,
    );
    expect(
      parseResolutionInput({ resolutionMode: 'REPLAY', sessionId: 's-1' }, emptyPc(), 'ADMIN'),
    ).toEqual({ mode: 'REPLAY', sessionId: 's-1' });
  });

  it('rejects an unknown mode string', () => {
    expect(() => parseResolutionInput({ resolutionMode: 'GUESS' }, emptyPc(), 'ADMIN')).toThrow(
      TemporalContextError,
    );
  });

  it('rejects a payload id supplied with no mode at all', () => {
    expect(() => parseResolutionInput({ snapshotId: 'snap-1' }, emptyPc(), 'ADMIN')).toThrow(
      /resolutionMode/,
    );
  });

  it('uses the resolution-input error code throughout', () => {
    try {
      parseResolutionInput({ resolutionMode: 'LIVE' }, emptyPc(), 'ADMIN');
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as TemporalContextError).code).toBe('INVALID_RESOLUTION_INPUT');
    }
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
    mockBuildResolutionContext.mockResolvedValue(rctxWith([PLAIN_NODE]));
    await start({ evaluationAsOf: '2026-03-04T05:06:07.000Z' });
    expect(capturedTemporalContext().evaluationAsOf).toBe('2026-03-04T05:06:07.000Z');
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
    await start({
      evaluationAsOf: '2026-03-04T05:06:07.000Z',
      encounterStart: '2026-03-04T04:00:00.000Z',
    });
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
