/**
 * R14-2 — the condition evaluator is selected from the version's CAPABILITY,
 * not from a parallel version-keyed table.
 *
 * The capability work of the previous round declared `evaluationMode` and
 * `requiresFactStore` per version, but the evaluator was still chosen from
 * `CONDITION_EVALUATORS`, a separate table keyed on the version. The load-time
 * coverage check proved every version had *an* evaluator — **never that the
 * evaluator agreed with its own capability row**. Two routing declarations per
 * version, and nothing compared them:
 *
 *   - `{ evaluationMode: 'kernel' }` + the LEGACY evaluator compiled, booted,
 *     passed coverage, and evaluated every condition through the untouched
 *     legacy path while the sweep, the preflight and the assembler all took the
 *     kernel branch.
 *   - `{ evaluationMode: 'kernel', requiresFactStore: false }` was equally
 *     representable: kernel evaluation against a store that was never
 *     assembled, so every membership gate answers unsatisfied and no error is
 *     raised anywhere.
 *
 * Both are now UNREPRESENTABLE rather than merely untrue:
 *
 *   1. `CONDITION_EVALUATORS` is keyed on the MODE. There is no per-version
 *      entry left to disagree with a per-version declaration.
 *   2. `requiresFactStore` is DERIVED from the mode via `modeRequiresFactStore`,
 *      not declared beside it. A version declares exactly one thing: its mode.
 *
 * The last block is the load-bearing one: it builds a synthetic REGISTRY — a
 * third and fourth policy version that do not exist in production — and shows
 * each one routes by its declared mode with **no evaluator registered for it
 * anywhere**. The real tables are frozen and are never mutated here.
 */

jest.mock('../../resolvers/Query', () => ({
  hydrateSignalDefinition: (row: unknown) => row,
}));

import {
  KNOWN_TEMPORAL_POLICY_VERSIONS,
  TEMPORAL_POLICY_CAPABILITIES,
  EVALUATION_MODES,
  policyCapabilities,
  requiresFactStore,
  usesKernelEvaluation,
  modeRequiresFactStore,
  capabilitiesFor,
} from '../../services/resolution/temporal/policy-registry';
import type { EvaluationMode } from '../../services/resolution/temporal/policy-registry';
import {
  evaluateGate,
  CONDITION_EVALUATORS,
  conditionEvaluatorForMode,
} from '../../services/resolution/gate-evaluator';
import type { GateEvaluationDeps } from '../../services/resolution/gate-evaluator';
import { factStoreForInput } from '../../services/resolution/temporal/fact-store';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';
import {
  GateProperties,
  GateAnswer,
  NodeResult,
  GateType,
  DefaultBehavior,
  AttributeCodeMap,
} from '../../services/resolution/types';
import type { PatientContext } from '../../services/confidence/types';

const AS_OF = '2026-08-11T00:00:00.000Z';
const ENCOUNTER_START = '2026-08-10T08:00:00.000Z';
const CODE_MAP: AttributeCodeMap = new Map();

/**
 * The behavioural discriminator between the two evaluators, and the reason it
 * works: `legacy-v0` reads `patientContext`, the kernel reads `factStore`. With
 * a populated context and an EMPTY store, the legacy evaluator satisfies this
 * gate and the kernel cannot.
 */
function codedMembershipGate(): GateProperties {
  return {
    title: 'has diabetes',
    gate_type: GateType.PATIENT_ATTRIBUTE,
    default_behavior: DefaultBehavior.SKIP,
    condition: { field: 'conditions', operator: 'includes_code', value: 'E11.9' },
  };
}

function patientWithDiabetes(): PatientContext {
  return {
    patientId: 'p',
    conditionCodes: [{ code: 'E11.9', system: 'ICD-10' }],
    medications: [],
    allergies: [],
    labResults: [],
  };
}

function depsFor(version: string, overrides: Partial<GateEvaluationDeps> = {}): GateEvaluationDeps {
  return {
    temporalContext: makeEvaluationTemporalContext({
      evaluationAsOf: AS_OF,
      encounterStart: ENCOUNTER_START,
      temporalPolicyVersion: version,
    }),
    pathwayDefaults: {},
    factStore: [],
    patientContext: patientWithDiabetes(),
    resolutionState: new Map<string, NodeResult>(),
    gateAnswers: new Map<string, GateAnswer>(),
    codeMap: CODE_MAP,
    ...overrides,
  };
}

function syntheticInput() {
  return { mode: 'SYNTHETIC' as const, patientContext: patientWithDiabetes() };
}

function clockFor(version: string) {
  return {
    evaluationAsOf: AS_OF,
    timezone: 'UTC',
    encounterStart: ENCOUNTER_START,
    temporalPolicyVersion: version,
  };
}

// ─── One declaration per version ──────────────────────────────────────

describe('a version declares its MODE and nothing else about its routing', () => {
  it('derives requiresFactStore from the mode rather than declaring it', () => {
    for (const version of KNOWN_TEMPORAL_POLICY_VERSIONS) {
      const row = TEMPORAL_POLICY_CAPABILITIES[version];
      // The whole row is reconstructible from the mode alone. If any version
      // ever declares the two independently, this fails.
      expect(row).toEqual(capabilitiesFor(row.evaluationMode));
      expect(row.requiresFactStore).toBe(modeRequiresFactStore(row.evaluationMode));
      expect(requiresFactStore(version)).toBe(modeRequiresFactStore(row.evaluationMode));
      expect(usesKernelEvaluation(version)).toBe(row.evaluationMode === 'kernel');
    }
  });

  it('states the mode → fact-store rule exactly once, and both ways', () => {
    expect(modeRequiresFactStore('kernel')).toBe(true);
    expect(modeRequiresFactStore('legacy')).toBe(false);
    expect(capabilitiesFor('kernel')).toEqual({
      evaluationMode: 'kernel',
      requiresFactStore: true,
    });
    expect(capabilitiesFor('legacy')).toEqual({
      evaluationMode: 'legacy',
      requiresFactStore: false,
    });
  });

  it('keys the evaluator table on the MODE, with no version entry', () => {
    expect(Object.keys(CONDITION_EVALUATORS).sort()).toEqual([...EVALUATION_MODES].sort());
    for (const version of KNOWN_TEMPORAL_POLICY_VERSIONS) {
      expect((CONDITION_EVALUATORS as Record<string, unknown>)[version]).toBeUndefined();
    }
  });

  it('covers every mode in the vocabulary, so an unwritten version is covered too', () => {
    for (const mode of EVALUATION_MODES) {
      expect(typeof conditionEvaluatorForMode(mode)).toBe('function');
    }
    expect(() => conditionEvaluatorForMode('shadow' as EvaluationMode)).toThrow(
      /no condition evaluator registered for evaluation mode "shadow"/,
    );
  });
});

// ─── The two halves agree, for every registered version ───────────────

describe.each(KNOWN_TEMPORAL_POLICY_VERSIONS)(
  'the evaluator and the fact store agree with %s’s capability row',
  (version) => {
    const mode = policyCapabilities(version).evaluationMode;
    const isKernel = mode === 'kernel';

    it(`evaluates conditions through the ${mode} evaluator`, async () => {
      // Populated context, EMPTY store: only the legacy evaluator can satisfy.
      const r = await evaluateGate(codedMembershipGate(), depsFor(version));
      expect(r.satisfied).toBe(!isKernel);
      // The kernel is the only path that produces the D5 signals at all, so
      // their presence is a second, independent witness of which one ran.
      expect(r.indeterminate !== undefined).toBe(isKernel);
    });

    it(`assembles a ${isKernel ? 'POPULATED' : 'EMPTY'} fact store`, () => {
      const store = factStoreForInput(syntheticInput(), clockFor(version));
      expect(store.length > 0).toBe(isKernel);
    });

    it('reads both decisions off the one capability row', () => {
      expect(requiresFactStore(version)).toBe(isKernel);
      expect(usesKernelEvaluation(version)).toBe(isKernel);
    });
  },
);

// ─── A synthetic registry: a version that cannot disagree with itself ─

/**
 * Re-require the routing modules against a SYNTHETIC policy registry carrying
 * two versions that do not exist in production — one declaring `kernel`, one
 * declaring `legacy`. Both alias `v1`'s policy SET, so the horizons are real;
 * only the capability row is synthetic.
 *
 * Built as a fixture module rather than by mutating `TEMPORAL_POLICY_CAPABILITIES`
 * or `CONDITION_EVALUATORS` — both are frozen, deliberately, and a test that
 * needed to unfreeze them would be testing a system that no longer exists.
 *
 * The point of the fixture: **neither synthetic version has an evaluator
 * registered anywhere.** Under the old version-keyed table, both would have
 * thrown `no condition evaluator registered for temporalPolicyVersion` at the
 * first condition gate — or, worse, a hand-added entry could have contradicted
 * the row. Routing by mode makes the evaluator follow from the declaration.
 */
const SYNTH_KERNEL = 'v2-synthetic-kernel';
const SYNTH_LEGACY = 'v2-synthetic-legacy';

function withSyntheticRegistry<T>(
  fn: (mods: {
    ge: typeof import('../../services/resolution/gate-evaluator');
    fs: typeof import('../../services/resolution/temporal/fact-store');
  }) => T,
): T {
  let result!: T;
  jest.isolateModules(() => {
    jest.doMock('../../services/resolution/temporal/policy-registry', () => {
      const actual = jest.requireActual(
        '../../services/resolution/temporal/policy-registry',
      ) as typeof import('../../services/resolution/temporal/policy-registry');
      const SYNTHETIC: Record<string, EvaluationMode> = {
        [SYNTH_KERNEL]: 'kernel',
        [SYNTH_LEGACY]: 'legacy',
      };
      // Synthetic versions borrow v1's horizons; only the capability row is new.
      const alias = (v: string) => (v in SYNTHETIC ? 'v1' : v);
      const caps = (v: string) =>
        v in SYNTHETIC ? actual.capabilitiesFor(SYNTHETIC[v]) : actual.policyCapabilities(v);
      return {
        ...actual,
        KNOWN_TEMPORAL_POLICY_VERSIONS: Object.freeze([
          ...actual.KNOWN_TEMPORAL_POLICY_VERSIONS,
          ...Object.keys(SYNTHETIC),
        ]),
        policyCapabilities: caps,
        usesKernelEvaluation: (v: string) => caps(v).evaluationMode === 'kernel',
        requiresFactStore: (v: string) => caps(v).requiresFactStore,
        getTemporalPolicy: (v: string) => actual.getTemporalPolicy(alias(v)),
        assertKnownPolicyVersion: (v: string) => actual.assertKnownPolicyVersion(alias(v)),
        systemDefaultFor: (f: never, v: string) => actual.systemDefaultFor(f, alias(v)),
      };
    });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const ge = require('../../services/resolution/gate-evaluator');
    const fs = require('../../services/resolution/temporal/fact-store');
    /* eslint-enable @typescript-eslint/no-var-requires */
    result = fn({ ge, fs });
  });
  jest.dontMock('../../services/resolution/temporal/policy-registry');
  return result;
}

describe('a synthetic version routes by its declared mode, with no evaluator of its own', () => {
  it('gives a version declaring `kernel` the kernel evaluator', async () => {
    const r = await withSyntheticRegistry(({ ge }) =>
      ge.evaluateGate(codedMembershipGate(), depsFor(SYNTH_KERNEL)),
    );
    // Populated context, empty store: the kernel cannot satisfy this.
    expect(r.satisfied).toBe(false);
    expect(r.indeterminate).toBe(false);
  });

  it('gives a version declaring `legacy` the legacy evaluator', async () => {
    const r = await withSyntheticRegistry(({ ge }) =>
      ge.evaluateGate(codedMembershipGate(), depsFor(SYNTH_LEGACY)),
    );
    expect(r.satisfied).toBe(true);
    // Only the kernel produces the D5 signals.
    expect(r.indeterminate).toBeUndefined();
  });

  it('gives the kernel version a populated fact store, from the SAME declaration', async () => {
    const store = withSyntheticRegistry(({ fs }) =>
      fs.factStoreForInput(syntheticInput(), clockFor(SYNTH_KERNEL)),
    );
    expect(store.length).toBeGreaterThan(0);
    expect(store[0]).toMatchObject({ kind: 'condition', code: 'E11.9' });
  });

  it('gives the legacy version an EMPTY fact store, from the SAME declaration', async () => {
    const store = withSyntheticRegistry(({ fs }) =>
      fs.factStoreForInput(syntheticInput(), clockFor(SYNTH_LEGACY)),
    );
    expect(store).toEqual([]);
  });

  it('never had an evaluator registered for either synthetic version', () => {
    // The property this whole block exists for: the evaluator followed from the
    // capability row, and nothing anywhere names these versions.
    withSyntheticRegistry(({ ge }) => {
      expect(Object.keys(ge.CONDITION_EVALUATORS).sort()).toEqual([...EVALUATION_MODES].sort());
      expect((ge.CONDITION_EVALUATORS as Record<string, unknown>)[SYNTH_KERNEL]).toBeUndefined();
      expect((ge.CONDITION_EVALUATORS as Record<string, unknown>)[SYNTH_LEGACY]).toBeUndefined();
    });
  });

  it('still refuses a version that is in no registry at all', async () => {
    await expect(
      withSyntheticRegistry(({ ge }) => ge.evaluateGate(codedMembershipGate(), depsFor('v99'))),
    ).rejects.toThrow(/v99/);
  });
});
