/**
 * Review finding 4 — policy-version semantics were spread across four unrelated
 * mechanisms, and one of them was a constant that is going to change.
 *
 * `TEMPORAL_POLICIES` said which horizons a version means. `CONDITION_EVALUATORS`
 * said which evaluator it routes to. And three separate call sites decided
 * everything else by comparing against `DEFAULT_TEMPORAL_POLICY_VERSION`:
 *
 *   - `resolution-context.ts:610`  `version !== DEFAULT` → use the kernel sweep
 *   - `resolution-context.ts:733`  `version === DEFAULT` → use the legacy preflight
 *   - `fact-store.ts:50`           `version === DEFAULT` → assemble no facts
 *
 * **That constant does double duty.** It is the DEPLOYMENT default (`index.ts:30`)
 * and it was also the semantic test for "is this the legacy path?". So flipping
 * it to `v1` — which is literally the rollout action this entire plan exists to
 * enable — would have given `v1` the legacy sweep, the legacy preflight and an
 * empty fact store, and handed `legacy-v0` the kernel treatment. Three silent
 * inversions from a one-line config change, on the one change the plan is for.
 *
 * The fix derives a `TemporalPolicyVersion` union from the registry, requires
 * the evaluator table to cover it (compile-time exhaustiveness plus a
 * module-load runtime assertion), and attaches per-version CAPABILITIES so the
 * three tests become lookups rather than identity comparisons.
 *
 * The load-bearing test is the last block: it flips the default to `v1` and
 * asserts every routing decision is unmoved. Nothing else in the suite would
 * notice the inversion, because today `v1 !== DEFAULT` is accidentally the same
 * answer as "v1 is the kernel path".
 */

jest.mock('../../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import {
  KNOWN_TEMPORAL_POLICY_VERSIONS,
  TEMPORAL_POLICY_CAPABILITIES,
  policyCapabilities,
  usesKernelEvaluation,
  requiresFactStore,
} from '../../services/resolution/temporal/policy-registry';
import {
  CONDITION_EVALUATORS,
  assertConditionEvaluatorCoverage,
  conditionEvaluatorForMode,
} from '../../services/resolution/gate-evaluator';
import type { GraphNode } from '../../services/confidence/types';
import { GateType, DefaultBehavior } from '../../services/resolution/types';

const AS_OF = '2026-08-11T00:00:00.000Z';
const ENCOUNTER_START = '2026-08-10T08:00:00.000Z';

// ─── The registry is the vocabulary ───────────────────────────────────

describe('every registered version is fully described', () => {
  it('has capabilities for every version that has a policy set', () => {
    for (const version of KNOWN_TEMPORAL_POLICY_VERSIONS) {
      expect(TEMPORAL_POLICY_CAPABILITIES[version]).toBeDefined();
      expect(['legacy', 'kernel']).toContain(policyCapabilities(version).evaluationMode);
    }
  });

  it('has a condition evaluator for every version that has a policy set', () => {
    // Re-keyed on the MODE at R14-2: the evaluator is reached THROUGH the
    // version's capability row, not from a parallel version-keyed table. The
    // property is unchanged and now unfalsifiable by a new version — see
    // `evaluator-selected-by-capability.test.ts`.
    for (const version of KNOWN_TEMPORAL_POLICY_VERSIONS) {
      const mode = policyCapabilities(version).evaluationMode;
      expect(typeof CONDITION_EVALUATORS[mode]).toBe('function');
      expect(conditionEvaluatorForMode(mode)).toBe(CONDITION_EVALUATORS[mode]);
    }
  });

  it('refuses a MODE registered with no evaluator, at LOAD rather than mid-traversal', () => {
    // The defect: a version added to the registry without an evaluator passed
    // `assertKnownPolicyVersion` at session creation and threw at the first
    // condition gate — on a session already persisted. Quantified over modes
    // since R14-2, which is what makes it cover versions that do not exist yet.
    expect(() => assertConditionEvaluatorCoverage({ legacy: CONDITION_EVALUATORS.legacy })).toThrow(
      /kernel/,
    );
    expect(() => assertConditionEvaluatorCoverage({ kernel: CONDITION_EVALUATORS.kernel })).toThrow(
      /legacy/,
    );
    expect(() => assertConditionEvaluatorCoverage(CONDITION_EVALUATORS)).not.toThrow();
  });

  it('throws for an unregistered version rather than defaulting its capabilities', () => {
    expect(() => policyCapabilities('v2')).toThrow(/unknown temporalPolicyVersion/);
    expect(() => usesKernelEvaluation('v2')).toThrow(/unknown temporalPolicyVersion/);
    expect(() => requiresFactStore('v2')).toThrow(/unknown temporalPolicyVersion/);
  });

  it('states what each version actually does', () => {
    expect(policyCapabilities('legacy-v0')).toEqual({
      evaluationMode: 'legacy',
      requiresFactStore: false,
    });
    expect(policyCapabilities('v1')).toEqual({
      evaluationMode: 'kernel',
      requiresFactStore: true,
    });
  });

  it('keeps the capability table frozen — a version must never change meaning', () => {
    expect(Object.isFrozen(TEMPORAL_POLICY_CAPABILITIES)).toBe(true);
    expect(Object.isFrozen(TEMPORAL_POLICY_CAPABILITIES['v1'])).toBe(true);
  });
});

// ─── The rollout property ─────────────────────────────────────────────

/**
 * Re-require the routing modules with `DEFAULT_TEMPORAL_POLICY_VERSION` set to
 * `version` — i.e. simulate the rollout flip, which is a deployment-config
 * change and nothing else.
 *
 * The whole module graph is rebuilt inside `isolateModules` so the constant is
 * genuinely different everywhere it is read. `TemporalContextError` from the
 * isolated copy is a DIFFERENT class object than the one imported at the top of
 * this file, so assertions here match on message, never `instanceof`.
 */
function withDefaultVersion<T>(
  version: string,
  fn: (mods: {
    factStore: typeof import('../../services/resolution/temporal/fact-store');
    rc: typeof import('../../resolvers/helpers/resolution-context');
  }) => T,
): T {
  let result!: T;
  jest.isolateModules(() => {
    jest.doMock('../../services/resolution/temporal/evaluation-context', () => ({
      ...jest.requireActual('../../services/resolution/temporal/evaluation-context'),
      DEFAULT_TEMPORAL_POLICY_VERSION: version,
    }));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const factStore = require('../../services/resolution/temporal/fact-store');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rc = require('../../resolvers/helpers/resolution-context');
    result = fn({ factStore, rc });
  });
  jest.dontMock('../../services/resolution/temporal/evaluation-context');
  return result;
}

const CODE_MAP = new Map([
  [
    'lab.a1c',
    {
      attributeName: 'lab.a1c',
      namespace: 'lab',
      system: 'LOINC',
      code: '4548-4',
      valueType: 'number' as const,
    },
  ],
]);

/** An ATTRIBUTE condition: swept by the kernel path only (D3, P1-8). */
function attributeGateNode(): GraphNode {
  return {
    id: 'g-a1c',
    nodeIdentifier: 'g-a1c',
    nodeType: 'Gate',
    properties: {
      title: 'A1c',
      gate_type: GateType.PATIENT_ATTRIBUTE,
      default_behavior: DefaultBehavior.SKIP,
      condition: { attribute: 'lab.a1c', operator: 'greater_than', value: 9 },
    },
  };
}

function syntheticInput() {
  return {
    mode: 'SYNTHETIC' as const,
    patientContext: {
      patientId: 'p',
      conditionCodes: [{ code: 'E11.9', system: 'ICD-10' }],
      medications: [],
      allergies: [],
      labResults: [],
    },
  };
}

function clockFor(version: string) {
  return {
    evaluationAsOf: AS_OF,
    timezone: 'UTC',
    encounterStart: ENCOUNTER_START,
    temporalPolicyVersion: version,
  };
}

describe.each([
  ['legacy-v0 is the deployment default (today)', 'legacy-v0'],
  ['v1 is the deployment default (after the rollout flip)', 'v1'],
])('routing is decided by CAPABILITY, not by the default — %s', (_label, defaultVersion) => {
  it('gives the kernel version an assembled fact store', () => {
    const store = withDefaultVersion(defaultVersion, ({ factStore }) =>
      factStore.factStoreForInput(syntheticInput(), clockFor('v1')),
    );
    expect(store.length).toBeGreaterThan(0);
    expect(store[0]).toMatchObject({ kind: 'condition', code: 'E11.9' });
  });

  it('gives the legacy version an EMPTY fact store', () => {
    const store = withDefaultVersion(defaultVersion, ({ factStore }) =>
      factStore.factStoreForInput(syntheticInput(), clockFor('legacy-v0')),
    );
    expect(store).toEqual([]);
  });

  it('gives the kernel version the kernel sweep — attribute conditions included', () => {
    const swept = withDefaultVersion(defaultVersion, ({ rc }) =>
      rc.sweepableConditions([attributeGateNode()], 'v1', CODE_MAP),
    );
    expect(swept).toEqual([{ label: 'g-a1c / condition 0', field: 'labs' }]);
  });

  it('gives the legacy version the legacy sweep — attribute conditions invisible', () => {
    const swept = withDefaultVersion(defaultVersion, ({ rc }) =>
      rc.sweepableConditions([attributeGateNode()], 'legacy-v0', CODE_MAP),
    );
    expect(swept).toEqual([]);
  });

  it('gives the kernel version the UNCONDITIONAL preflight, anchor or not (P1-18)', () => {
    // The v1 preflight validates every condition even when an encounterStart is
    // supplied; the legacy one returns early. A malformed NODE horizon is the
    // observable difference.
    const badHorizonNode: GraphNode = {
      id: 'g-bad',
      nodeIdentifier: 'g-bad',
      nodeType: 'Gate',
      properties: {
        title: 'bad',
        gate_type: GateType.PATIENT_ATTRIBUTE,
        default_behavior: DefaultBehavior.SKIP,
        condition: {
          field: 'labs',
          operator: 'greater_than',
          value: '4548-4',
          horizon: 'FORTNIGHT',
        },
      },
    };
    const rctxFor = (rc: typeof import('../../resolvers/helpers/resolution-context')) => ({
      graphContext: {
        allNodes: [badHorizonNode],
        allEdges: [],
        incomingEdges: () => [],
        outgoingEdges: () => [],
        getNode: () => undefined,
        linkedNodes: () => [],
      },
      edges: [],
      signals: [],
      thresholds: { autoResolveThreshold: 0.8, suggestThreshold: 0.5 },
      confidenceEngine: {} as never,
      codeMap: CODE_MAP,
      temporalDefaults: {},
    });

    const results = withDefaultVersion(defaultVersion, ({ rc }) => ({
      v1: (() => {
        try {
          rc.assertEncounterAnchor(rctxFor(rc) as never, clockFor('v1') as never);
          return null;
        } catch (e) {
          return (e as Error).message;
        }
      })(),
      legacy: (() => {
        try {
          rc.assertEncounterAnchor(rctxFor(rc) as never, clockFor('legacy-v0') as never);
          return null;
        } catch (e) {
          return (e as Error).message;
        }
      })(),
    }));

    expect(results.v1).toMatch(/FORTNIGHT/);
    // legacy-v0 returns early on the supplied anchor and never parses it —
    // today's behavior, frozen by locked decision #1.
    expect(results.legacy).toBeNull();
  });
});
