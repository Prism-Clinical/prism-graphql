# Evaluation Pipeline 02 — Pure Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `evaluate(inputs, env, observations, scope)`, the deterministic core of the spec, as
new code that no resolver calls yet.

**Architecture:** New modules live under `services/resolution/pipeline/`, plus pure lookups in
`services/medications/safety-reference.ts`. Existing code gets only additive, behaviour-preserving
changes:
- `ConfidenceEngine` splits into load and score.
- `TraversalEngine.traverse` accepts overrides as input.
- A few private helpers become exports.
- The import validator gains one rule.

Resolvers are untouched; plan 03 wires them.

**Tech Stack:** TypeScript, Jest + ts-jest (`diagnostics: false`), `pg`, fast-check 3.

**Spec:** `docs/superpowers/specs/2026-09-13-evaluation-pipeline-design.md` — contracts C1–C4, §1,
§2, decisions D2–D4, D10–D12, D14.
**Overview:** `docs/superpowers/plans/2026-09-14-evaluation-pipeline-00-overview.md`.
**Predecessor:** plan 01 gate PASSED (`docs/.../01-performance-gate.md`, *Gate result*).

## Global Constraints

- **No users; no compatibility seams.** No resolver behaviour changes, and every existing test
  must pass unmodified. The single behaviour change is Task 8's import rule, which the spec
  requires and which no live pathway triggers.
- **Suite invariant:** `patient-match-scorer` and `data-completeness-scorer` (9 tests) remain the
  only failures. Baseline on `origin/main` @ `2454130`: 1645 passed / 9 failed / 1 skipped.
- **Test files are not typechecked**, so every invariant needs a runtime throw plus a test that
  fails without it. **Assert the positive, then revert the fix and watch the test fail.**
- **Commands** use absolute paths, never `cd … && …`. `W` below is
  `/home/claude/workspace/features/feat-evaluation-pipeline-02-pure-core/prism-graphql`.
  - Test one file: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/<file>`
  - Typecheck: `$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit`
- **Commit messages** use conventional prefixes and end with exactly one trailer line:
  `Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH`.
  No `@anthropic.com` address and no `Co-Authored-By` line (`CLAUDE.md`).
- **Evaluation never calls RxNav** (D14). It never reads the database either: all I/O is in
  `loadEvaluationEnv` and the observation provider.

## File map

| File | Responsibility | Task |
|---|---|---|
| `services/confidence/confidence-engine.ts` (modify) | `loadScoringConfig` (DB) + `scorePathway` (pure); `computePathwayConfidence` composes them | 1 |
| `services/medications/normalizer.ts`, `ddi-pass.ts`, `ddi-pass-single-pathway.ts` (modify) | Export `canonicalKey`, `buildDrugDrugFinding`, `toEngineDrug`, `ddiSuppressionReason` | 2 |
| `services/medications/safety-reference.ts` (create) | Load normalisation, pair, class and allergy rows once; pure `normalizedFor`, `interactionBetween` | 2 |
| `services/resolution/pipeline/types.ts` (create) | Pipeline data types | 2 |
| `services/resolution/pipeline/canonical.ts` (create) | Canonical JSON + sha256 | 2 |
| `services/resolution/pipeline/safety.ts` (create) | Stage 5 `patientSafety`, stage 6 `pairSafety` | 2 |
| `services/resolution/dotted-path.ts` (create), `resolvers/helpers/resolution-context.ts` (modify) | Shared `resolveDottedPath` | 3 |
| `services/resolution/pipeline/observations.ts` (create) | Observation keys, `replayObservations`, `liveObservations` | 3 |
| `services/resolution/traversal-engine.ts` (modify) | `traverse(…, overrides)` pre-seeds held overrides | 4 |
| `services/resolution/pipeline/load-env.ts` (create) | `loadEvaluationEnv` snapshot, fingerprints, candidate universe | 5 |
| `services/resolution/types.ts` (modify) | `NodeEligibility`, `NodeDisposition` on `NodeResult` | 6 |
| `services/resolution/pipeline/findings.ts`, `disposition.ts`, `readiness.ts` (create) | Stage 4 extras, the C2 layers, stage 7 | 6 |
| `services/resolution/temporal/fact-store.ts` (modify) | Export `factStoreFor(effective, clock)` | 7 |
| `services/resolution/pipeline/evaluate.ts` (create) | Composes the stages; `resultHashOf` | 7 |
| `services/import/validator.ts` (modify) | `depends_on` may not target Medication | 8 |
| root `package.json` (modify) | fast-check devDependency | 9 |

---

### Task 0: Branches and worktree

- [ ] **Step 1: Ensure the integration branch exists**

```bash
R=/home/claude/workspace/prism-graphql
git -C $R fetch -q origin
git -C $R ls-remote --exit-code --heads origin feat/evaluation-pipeline \
  || git -C $R push origin origin/main:refs/heads/feat/evaluation-pipeline
```
Expected: the branch exists on `origin`. It is created from `main` if it was missing. **Creating
a remote branch is outward-facing: confirm with the user before running the push.**

- [ ] **Step 2: Create the plan worktree**

Run `/new-feature` for prism-graphql, branch `feat/evaluation-pipeline-02-pure-core`, **from
`origin/feat/evaluation-pipeline`** (not `origin/main`). Then:

```bash
W=/home/claude/workspace/features/feat-evaluation-pipeline-02-pure-core/prism-graphql
npm install --prefix $W
npm test --prefix $W/apps/pathway-service -- --runInBand 2>&1 | grep -E "^Tests:"
```
Expected: `Tests: 9 failed, 1 skipped, 1645 passed, 1655 total`. Record it as the plan's baseline
row. If `feat/evaluation-pipeline` already contains plan 01's benchmark, expect `2 skipped`
instead.

---

### Task 1: Split scoring into load (DB) and score (pure)

**Files:**
- Modify: `apps/pathway-service/src/services/confidence/confidence-engine.ts:31-255`
- Test: `apps/pathway-service/src/__tests__/pipeline-scoring-split.test.ts`

**Interfaces:**
- Produces:
  - `interface ScoringConfig { adminEvidenceEntries: AdminEvidenceEntry[]; weightMatrix: WeightMatrix; nodeWeightMap: Map<string, number>; propagationOverrides: Map<string, Record<string, PropagationConfig>>; thresholds: ResolvedThresholds }`
  - `ConfidenceEngine.loadScoringConfig(params: { pool: Pool; pathwayId: string; nodes: GraphNode[]; signalDefinitions: SignalDefinition[]; institutionId?: string; organizationId?: string; adminEvidenceEntries?: AdminEvidenceEntry[] }): Promise<ScoringConfig>`
  - `ConfidenceEngine.scorePathway(config: ScoringConfig, params: ScoringParams): PathwayConfidenceResult`. This is synchronous and makes no queries.
  - `interface ScoringParams { pathwayId: string; nodes: GraphNode[]; edges: GraphEdge[]; signalDefinitions: SignalDefinition[]; patientContext: PatientContext; contextNodes?: GraphNode[] }`

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/pipeline-scoring-split.test.ts`:

```ts
import { ConfidenceEngine } from '../services/confidence/confidence-engine';
import { ScorerRegistry } from '../services/confidence/scorer-registry';
import { WeightCascadeResolver } from '../services/confidence/weight-cascade-resolver';
import { GraphEdge, GraphNode, ScoringType, SignalDefinition } from '../services/confidence/types';
import { REFERENCE_PATIENT } from './fixtures/reference-patient-context';

const signal: SignalDefinition = {
  id: '00000000-0000-4000-a000-000000000001',
  name: 'data_completeness',
  displayName: 'Data Completeness',
  description: '',
  scoringType: ScoringType.DATA_PRESENCE,
  scoringRules: {},
  propagationConfig: { mode: 'transitive_with_decay', decayFactor: 0.8 },
  scope: 'SYSTEM',
  defaultWeight: 1,
  isActive: true,
};
const nodes: GraphNode[] = [
  { id: 'a', nodeIdentifier: 'lab-1', nodeType: 'LabTest', properties: {} },
  { id: 'b', nodeIdentifier: 'step-1', nodeType: 'Step', properties: {} },
];
const edges: GraphEdge[] = [
  { id: 'e', edgeType: 'HAS_LAB_TEST', sourceId: 'lab-1', targetId: 'step-1', properties: {} },
];

function engine(): ConfidenceEngine {
  const registry = new ScorerRegistry();
  registry.register({
    scoringType: ScoringType.DATA_PRESENCE,
    declareRequiredInputs: () => [],
    score: ({ node }: { node: GraphNode }) =>
      node.nodeIdentifier === 'lab-1'
        ? { score: 0.3, missingInputs: ['result_value'] }
        : { score: 0.9, missingInputs: [] },
    propagate: ({ sourceScore, hopDistance, propagationConfig }: any) => ({
      propagatedScore: sourceScore * Math.pow(propagationConfig.decayFactor ?? 0.8, hopDistance),
      shouldPropagate: true,
    }),
  } as never);
  return new ConfidenceEngine(registry, new WeightCascadeResolver());
}

describe('ConfidenceEngine load/score split', () => {
  it('scorePathway makes no queries and equals computePathwayConfidence', async () => {
    const e = engine();
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const params = { pathwayId: 'pw', nodes, edges, signalDefinitions: [signal], patientContext: REFERENCE_PATIENT };

    const viaCompute = await e.computePathwayConfidence({ pool: pool as never, ...params });
    const config = await e.loadScoringConfig({ pool: pool as never, pathwayId: 'pw', nodes, signalDefinitions: [signal] });
    pool.query.mockClear();

    const pure = e.scorePathway(config, params);

    expect(pool.query).not.toHaveBeenCalled();
    expect(pure).toEqual(viaCompute);
    // Positive: whole-graph propagation ran (0.3 × 0.8 onto step-1).
    expect(pure.nodes.find((n) => n.nodeIdentifier === 'step-1')!.confidence).toBeCloseTo(0.24, 2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-scoring-split.test.ts`
Expected: FAIL with `e.loadScoringConfig is not a function`.

- [ ] **Step 3: Implement the split**

In `confidence-engine.ts`:

1. After the imports, add:

```ts
/** Everything scoring reads from the database, loaded once (spec C4). */
export interface ScoringConfig {
  adminEvidenceEntries: AdminEvidenceEntry[];
  weightMatrix: WeightMatrix;
  nodeWeightMap: Map<string, number>;
  propagationOverrides: Map<string, Record<string, PropagationConfig>>;
  thresholds: ResolvedThresholds;
}

export interface ScoringParams {
  pathwayId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  signalDefinitions: SignalDefinition[];
  patientContext: PatientContext;
  /** See `computePathwayConfidence`. */
  contextNodes?: GraphNode[];
}
```

2. Replace the **body** of `computePathwayConfidence` (lines 58–254; keep the signature and its
   JSDoc at 31–57) with:

```ts
    const config = await this.loadScoringConfig(params);
    return this.scorePathway(config, params);
```

3. Add `loadScoringConfig` directly after `computePathwayConfidence`. The queries run in today's
   order (admin evidence, weights, node weights, thresholds), so pool mocks sequenced by call order
   keep working.

```ts
  async loadScoringConfig(params: {
    pool: Pool;
    pathwayId: string;
    nodes: GraphNode[];
    signalDefinitions: SignalDefinition[];
    institutionId?: string;
    organizationId?: string;
    adminEvidenceEntries?: AdminEvidenceEntry[];
  }): Promise<ScoringConfig> {
    const { pool, pathwayId, nodes, signalDefinitions, institutionId, organizationId } = params;

    let adminEvidenceEntries = params.adminEvidenceEntries;
    if (!adminEvidenceEntries) {
      const adminEvResult = await pool.query(
        'SELECT * FROM confidence_admin_evidence WHERE pathway_id = $1',
        [pathwayId]
      );
      adminEvidenceEntries = adminEvResult.rows.map((row: any) => ({
        id: row.id,
        pathwayId: row.pathway_id,
        nodeIdentifier: row.node_identifier,
        title: row.title,
        source: row.source,
        year: row.year,
        evidenceLevel: row.evidence_level,
        url: row.url,
        notes: row.notes,
      }));
    }

    const weightMatrix = await this.cascadeResolver.resolveAllWeights({
      pool,
      pathwayId,
      signalDefinitions,
      nodeIdentifiers: nodes.map(n => ({ nodeIdentifier: n.nodeIdentifier, nodeType: n.nodeType })),
      institutionId,
      organizationId,
    });

    const { nodeWeightMap, propagationOverrides } = await this.loadNodeWeightsAndOverrides(pool, pathwayId);

    const thresholds = await this.cascadeResolver.resolveThresholds({
      pool,
      pathwayId,
      institutionId,
      organizationId,
    });

    return { adminEvidenceEntries, weightMatrix, nodeWeightMap, propagationOverrides, thresholds };
  }
```

4. Add `scorePathway` directly after `loadScoringConfig`:

```ts
  /** Pure scoring over preloaded configuration. Makes no queries. */
  scorePathway(config: ScoringConfig, params: ScoringParams): PathwayConfidenceResult {
    const { adminEvidenceEntries, weightMatrix, nodeWeightMap, propagationOverrides, thresholds } = config;
    const { pathwayId, nodes, edges, signalDefinitions, patientContext } = params;
```

   Then **move, verbatim**, two ranges of the original method body into it:
   - the original lines **80–82** (the `// Built from the WIDER set…` comment and
     `const graphContext = this.buildGraphContext(params.contextNodes ?? nodes, edges);`);
   - the original lines **105–254** (from `// Score each (node, signal) pair` through the closing
     `};` of the `return { pathwayId, overallConfidence, nodes: nodeResults }` statement).

   Close the method with `  }`. Those ranges reference only the names destructured above. The
   original lines 60–78, 84–92, 94–95 and 97–103 are now inside `loadScoringConfig` and must not
   remain anywhere else.

- [ ] **Step 4: Run the new test and the existing engine tests**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-scoring-split.test.ts src/__tests__/confidence-engine.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: both suites PASS, with no change to any assertion in `confidence-engine.test.ts`.
Typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git -C $W add apps/pathway-service/src/services/confidence/confidence-engine.ts apps/pathway-service/src/__tests__/pipeline-scoring-split.test.ts
git -C $W commit -m "refactor(pathway-service): split confidence scoring into load and pure score

computePathwayConfidence now composes loadScoringConfig (the four queries,
in their existing order) with a synchronous scorePathway that reads only
preloaded configuration. Behaviour is unchanged.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 2: Safety reference and pure patient/pair safety

**Files:**
- Modify:
  - `apps/pathway-service/src/services/medications/normalizer.ts` (export `canonicalKey`, `CacheKey`)
  - `apps/pathway-service/src/services/medications/ddi-pass.ts` (export `buildDrugDrugFinding`, `toEngineDrug`)
  - `apps/pathway-service/src/services/medications/ddi-pass-single-pathway.ts` (export `ddiSuppressionReason`)
- Create:
  - `apps/pathway-service/src/services/medications/safety-reference.ts`
  - `apps/pathway-service/src/services/resolution/pipeline/types.ts`
  - `apps/pathway-service/src/services/resolution/pipeline/canonical.ts`
  - `apps/pathway-service/src/services/resolution/pipeline/safety.ts`
- Test: `apps/pathway-service/src/__tests__/pipeline-safety.test.ts`

**Interfaces:**
- Consumes: `fetchAllergyMappings(pool, allergies)`, `matchDrugAllergyAgainstMappings(drug, mappings)`
  (`ddi-engine.ts`); `DdiCandidate`, `DdiFinding` (`ddi-pass.ts`).
- Produces:
  - `interface SafetyReference { normalized: Map<string, NormalizedMedication>; pairs: Map<string, InteractionResult>; classRules: ClassRule[]; allergyMappings: AllergyMapping[] }`. The `normalized` key is `${text}|${system}|${code}` after `canonicalKey`.
  - `loadSafetyReference(db: Pick<Pool, 'query'>, universe: { medications: MedicationInput[]; allergySnomedCodes: string[] }): Promise<SafetyReference>`
  - `normalizedKey(input: MedicationInput): string`
  - `normalizedFor(ref, input: MedicationInput): NormalizedMedication | null`
  - `interactionBetween(ref, a: { rxcui: string; atcClasses: string[] }, b: { rxcui: string; atcClasses: string[] }): InteractionResult | null`
  - `patientSafety(ref, candidates: DdiCandidate[], patient: PatientContext): SafetyOutcome`, where `interface SafetyOutcome { findings: ScopedFinding[]; suppressed: Set<string>; unavailable: SafetyUnavailable[] }`
  - `pairSafety(ref, candidates: DdiCandidate[]): { findings: ScopedFinding[]; suppressed: Set<string> }`
  - `canonicalJson(value: unknown): string`, `hashOf(value: unknown): string`
  - All types in `pipeline/types.ts` (below).

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/pipeline-safety.test.ts`:

```ts
jest.mock('../services/medications/rxnav-client', () => ({
  findRxcuiByString: jest.fn(),
  getAtcClasses: jest.fn(),
  getIngredientRxcui: jest.fn(),
  getRxcuiByNdc: jest.fn(),
}));

import * as rxnav from '../services/medications/rxnav-client';
import { interactionBetween, loadSafetyReference } from '../services/medications/safety-reference';
import { pairSafety, patientSafety } from '../services/resolution/pipeline/safety';
import type { PatientContext } from '../services/confidence/types';

// The cache key is text + system + code (canonicalKey), so a coded patient
// medication needs its own row.
const cacheRow = (text: string, rxcui: string, atc: string[], system = '', code = '') => ({
  input_text: text, input_system: system, input_code: code,
  ingredient_rxcui: rxcui, ingredient_name: text, atc_classes: atc,
});

function fakeDb(rows: { cache?: unknown[]; pairs?: unknown[]; classes?: unknown[]; allergies?: unknown[] }) {
  return {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('medication_normalization_cache')) return { rows: rows.cache ?? [] };
      if (sql.includes('FROM drug_interactions')) return { rows: rows.pairs ?? [] };
      if (sql.includes('FROM drug_class_interactions')) return { rows: rows.classes ?? [] };
      if (sql.includes('allergy_class_mappings')) return { rows: rows.allergies ?? [] };
      throw new Error(`unexpected query: ${sql}`);
    }),
  };
}

const CACHE = [
  cacheRow('amoxicillin', '723', ['J01CA04']),
  cacheRow('warfarin', '11289', ['B01AA03']),
  cacheRow('warfarin', '11289', ['B01AA03'], 'RxNorm', '11289'),
  cacheRow('aspirin', '1191', ['B01AC06', 'N02BA01']),
];
const patient = (p: Partial<PatientContext> = {}): PatientContext =>
  ({ patientId: 'p', conditionCodes: [], medications: [], labResults: [], allergies: [], ...p });
const candidate = (id: string, drugName: string) => ({ recommendationId: id, drugName, meta: { nodeType: 'Medication' } });
const universe = {
  medications: [{ text: 'Amoxicillin' }, { text: 'Warfarin' }, { text: 'Warfarin', system: 'RxNorm', code: '11289' }, { text: 'Aspirin' }, { text: 'Unobtainium' }],
  allergySnomedCodes: ['91936005'],
};

describe('safety reference', () => {
  it('loads every row once and never calls RxNav', async () => {
    const db = fakeDb({
      cache: CACHE,
      pairs: [{ rxcui_a: '11289', rxcui_b: '1191', severity: 'SEVERE', mechanism: 'bleeding', clinical_advice: 'avoid' }],
      classes: [{ atc_class_a: 'B01A', atc_class_b: 'J01C', severity: 'MODERATE', mechanism: 'm', clinical_advice: 'c' }],
      allergies: [{ snomed_code: '91936005', snomed_display: 'Allergy to penicillin', atc_class: 'J01C' }],
    });
    const ref = await loadSafetyReference(db as never, universe);

    expect(db.query).toHaveBeenCalledTimes(4);
    expect(ref.normalized.size).toBe(4);
    expect(ref.pairs.size).toBe(1);
    expect(ref.classRules).toHaveLength(1);
    expect(ref.allergyMappings).toHaveLength(1);
    for (const fn of Object.values(rxnav)) expect(fn).not.toHaveBeenCalled();
  });

  it('interactionBetween: pair wins, class matches both orientations, most severe class, no self', async () => {
    const ref = await loadSafetyReference(fakeDb({
      cache: CACHE,
      pairs: [{ rxcui_a: '11289', rxcui_b: '1191', severity: 'SEVERE', mechanism: 'pair', clinical_advice: null }],
      classes: [
        { atc_class_a: 'B01A', atc_class_b: 'B01A', severity: 'CONTRAINDICATED', mechanism: 'class', clinical_advice: null },
        { atc_class_a: 'J01C', atc_class_b: 'B01AA', severity: 'MODERATE', mechanism: 'mod', clinical_advice: null },
        { atc_class_a: 'B01AA', atc_class_b: 'J01CA', severity: 'SEVERE', mechanism: 'sev', clinical_advice: null },
      ],
    }) as never, universe);
    const drug = (text: string) => { const n = ref.normalized.get(`${text}||`)!; return { rxcui: n.ingredientRxcui, atcClasses: n.atcClasses }; };

    expect(interactionBetween(ref, drug('warfarin'), drug('aspirin'))).toMatchObject({ matchType: 'PAIR', severity: 'SEVERE' });
    expect(interactionBetween(ref, drug('aspirin'), drug('warfarin'))).toMatchObject({ matchType: 'PAIR', severity: 'SEVERE' });
    expect(interactionBetween(ref, drug('amoxicillin'), drug('warfarin'))).toMatchObject({ matchType: 'CLASS', severity: 'SEVERE' });
    expect(interactionBetween(ref, drug('warfarin'), drug('amoxicillin'))).toMatchObject({ matchType: 'CLASS', severity: 'SEVERE' });
    expect(interactionBetween(ref, drug('warfarin'), drug('warfarin'))).toBeNull();
  });
});

describe('patientSafety / pairSafety', () => {
  async function ref() {
    return loadSafetyReference(fakeDb({
      cache: CACHE,
      pairs: [{ rxcui_a: '11289', rxcui_b: '1191', severity: 'SEVERE', mechanism: 'bleeding', clinical_advice: 'avoid' }],
      allergies: [{ snomed_code: '91936005', snomed_display: 'Allergy to penicillin', atc_class: 'J01C' }],
    }) as never, universe);
  }

  it('suppresses on patient allergy and patient medication, scoped PATIENT', async () => {
    const out = patientSafety(await ref(), [candidate('med-amox', 'Amoxicillin'), candidate('med-asa', 'Aspirin')], patient({
      allergies: [{ code: '91936005', system: 'SNOMED' }],
      medications: [{ code: '11289', system: 'RxNorm', display: 'Warfarin' }],
    }));

    expect([...out.suppressed].sort()).toEqual(['med-amox', 'med-asa']);
    expect(out.findings.map((f) => [f.recommendationId, f.category, f.scope])).toEqual(
      expect.arrayContaining([['med-amox', 'ALLERGY', 'PATIENT'], ['med-asa', 'DDI_SEVERE', 'PATIENT']]),
    );
    expect(out.unavailable).toEqual([]);
  });

  it('reports unnormalised candidates and patient medications instead of skipping them (D14)', async () => {
    const out = patientSafety(await ref(), [candidate('med-x', 'Unobtainium'), candidate('med-amox', 'Amoxicillin')], patient({
      medications: [{ code: '999', system: 'RxNorm', display: 'Mysterydrug' }],
    }));

    expect(out.unavailable).toEqual([
      { drugName: 'Mysterydrug', source: 'PATIENT_MEDICATION' },
      { nodeId: 'med-x', drugName: 'Unobtainium', source: 'CANDIDATE' },
    ]);
  });

  it('pairSafety checks every pair and suppresses both sides, scoped SET', async () => {
    const out = pairSafety(await ref(), [candidate('a', 'Warfarin'), candidate('b', 'Aspirin'), candidate('c', 'Amoxicillin')]);

    expect([...out.suppressed].sort()).toEqual(['a', 'b']);
    expect(out.findings).toHaveLength(2);
    expect(out.findings.every((f) => f.scope === 'SET')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-safety.test.ts`
Expected: FAIL with `Cannot find module '../services/medications/safety-reference'`.

- [ ] **Step 3: Export the helpers**

- `normalizer.ts`: `interface CacheKey {` → `export interface CacheKey {`, and
  `function canonicalKey(` → `export function canonicalKey(`.
- `ddi-pass.ts`: `function buildDrugDrugFinding(` → `export function buildDrugDrugFinding(`, and
  `function toEngineDrug(` → `export function toEngineDrug(`.
- `ddi-pass-single-pathway.ts`: `function ddiSuppressionReason(` →
  `export function ddiSuppressionReason(`.

- [ ] **Step 4: Create `pipeline/canonical.ts`**

```ts
import { createHash } from 'crypto';

/**
 * JSON with object keys sorted at every depth. Maps become entry arrays sorted
 * by key; Sets become arrays sorted by canonical form; `undefined` object
 * fields are dropped. Arrays keep their order, so a caller sorts any array
 * whose order carries no meaning.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(v: unknown): unknown {
  if (v instanceof Map) {
    return [...v.entries()]
      .map(([k, x]) => [k, normalize(x)] as const)
      .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
  }
  if (v instanceof Set) {
    return [...v].map(normalize).sort((a, b) => {
      const x = JSON.stringify(a); const y = JSON.stringify(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }
  if (Array.isArray(v)) return v.map(normalize);
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = normalize(x);
    }
    return out;
  }
  return v;
}

export const hashOf = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
```

- [ ] **Step 5: Create `pipeline/types.ts`**

```ts
import type { PatientContext } from '../../confidence/types';
import type { AdditionalContextInput } from '../../../resolvers/mutations/resolution';
import type { EvaluationTemporalContext } from '../temporal/evaluation-context';
import type { BlockerType } from '../../../types';
import type { CatchUpItem } from '../care-plan-merge';
import type { DdiFinding } from '../../medications/ddi-pass';
import type { GateAnswer, PendingQuestion, ProviderOverride, RedFlag, ResolutionState } from '../types';

export type ObservationKey = string;

/** A successful LLM verdict recorded as a session input (spec C1). */
export interface LlmObservation {
  key: ObservationKey;
  gateId: string;
  chosenBranch: string;
  confidence: number;
  reasoning: string;
  model: string;
  acquiredAt: string;
}

/** What a session stores: inputs only (spec §1). */
export interface SessionInputs {
  pathwayId: string;
  graphFingerprint: string;
  temporalContext: EvaluationTemporalContext;
  initialPatientContext: PatientContext;
  additionalContext: Partial<AdditionalContextInput>;
  gateAnswers: Map<string, GateAnswer>;
  providerOverrides: Map<string, ProviderOverride>;
  observations: Map<ObservationKey, LlmObservation>;
  revision: number;
}

export type EvaluationScope = 'ROOT' | 'CONTRIBUTION';
export type BlockerScope = 'COMPLETENESS' | 'OUTPUT';
export type PipelineBlockerType = BlockerType | 'SAFETY_DATA_UNAVAILABLE';

export interface ScopedBlocker {
  scope: BlockerScope;
  type: PipelineBlockerType;
  description: string;
  relatedNodeIds: string[];
}

export interface ScopedFinding extends DdiFinding {
  scope: 'PATIENT' | 'SET';
}

/** A medication the snapshot could not normalise (D14). */
export interface SafetyUnavailable {
  drugName: string;
  source: 'CANDIDATE' | 'PATIENT_MEDICATION';
  nodeId?: string;
}

export interface EvaluationResult {
  scope: EvaluationScope;
  resolutionState: ResolutionState;
  pendingQuestions: PendingQuestion[];
  redFlags: RedFlag[];
  safetyFindings: ScopedFinding[];
  safetyUnavailable: SafetyUnavailable[];
  catchUpItems: CatchUpItem[];
  gateContextFields: Map<string, string[]>;
  readiness: { ready: boolean; blockers: ScopedBlocker[] };
  status: 'ACTIVE' | 'DEGRADED';
  observationsUsed: ObservationKey[];
  envFingerprint: string;
  resultHash: string;
}
```

- [ ] **Step 6: Create `services/medications/safety-reference.ts`**

```ts
import { Pool } from 'pg';
import { canonicalKey } from './normalizer';
import { AllergyMapping, DdiSeverity, InteractionResult, fetchAllergyMappings } from './ddi-engine';
import { MedicationInput, NormalizedMedication } from './types';

export interface ClassRule {
  atcClassA: string;
  atcClassB: string;
  severity: DdiSeverity;
  mechanism: string | null;
  clinicalAdvice: string | null;
}

/**
 * Every row a safety pass reads, loaded once inside the evaluation snapshot
 * (spec C4). The pure functions below reproduce `checkDrugDrugInteraction`
 * and `lookupNormalizedMedication` over it, so evaluation makes no queries.
 */
export interface SafetyReference {
  /** `normalizedKey(input)` → normalised medication. Absent means not normalised. */
  normalized: Map<string, NormalizedMedication>;
  /** `pairKey(rxcuiA, rxcuiB)` → pair rule. */
  pairs: Map<string, InteractionResult>;
  classRules: ClassRule[];
  allergyMappings: AllergyMapping[];
}

const SEVERITY_RANK: Record<DdiSeverity, number> = { CONTRAINDICATED: 1, SEVERE: 2, MODERATE: 3, MINOR: 4 };

export function normalizedKey(input: MedicationInput): string {
  const k = canonicalKey(input);
  return `${k.text}|${k.system}|${k.code}`;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export async function loadSafetyReference(
  db: Pick<Pool, 'query'>,
  universe: { medications: MedicationInput[]; allergySnomedCodes: string[] },
): Promise<SafetyReference> {
  const keys = [...new Map(universe.medications.map((m) => [normalizedKey(m), canonicalKey(m)])).values()];

  const normalized = new Map<string, NormalizedMedication>();
  if (keys.length > 0) {
    const r = await db.query(
      `SELECT input_text, input_system, input_code, ingredient_rxcui, ingredient_name, atc_classes
         FROM medication_normalization_cache
        WHERE (input_text, input_system, input_code) IN (
          SELECT t, s, c FROM unnest($1::text[], $2::text[], $3::text[]) AS u(t, s, c))`,
      [keys.map((k) => k.text), keys.map((k) => k.system), keys.map((k) => k.code)],
    );
    for (const row of r.rows) {
      if (!row.ingredient_rxcui) continue; // cached NULL = tried and unmappable: still not normalised
      normalized.set(`${row.input_text}|${row.input_system}|${row.input_code}`, {
        ingredientRxcui: row.ingredient_rxcui,
        ingredientName: row.ingredient_name ?? row.input_text,
        atcClasses: row.atc_classes ?? [],
      });
    }
  }

  const rxcuis = [...new Set([...normalized.values()].map((n) => n.ingredientRxcui))];
  const pairs = new Map<string, InteractionResult>();
  if (rxcuis.length > 1) {
    const r = await db.query(
      `SELECT rxcui_a, rxcui_b, severity, mechanism, clinical_advice
         FROM drug_interactions
        WHERE rxcui_a = ANY($1::text[]) AND rxcui_b = ANY($1::text[])`,
      [rxcuis],
    );
    for (const row of r.rows) {
      pairs.set(pairKey(row.rxcui_a, row.rxcui_b), {
        severity: row.severity as DdiSeverity,
        mechanism: row.mechanism,
        clinicalAdvice: row.clinical_advice,
        matchType: 'PAIR',
        matchedClasses: null,
      });
    }
  }

  // ponytail: whole table — a small curated rule set. Filter by ATC prefix in SQL if it grows.
  const cr = await db.query(
    `SELECT atc_class_a, atc_class_b, severity, mechanism, clinical_advice FROM drug_class_interactions`,
  );
  const classRules: ClassRule[] = cr.rows.map((row) => ({
    atcClassA: row.atc_class_a,
    atcClassB: row.atc_class_b,
    severity: row.severity as DdiSeverity,
    mechanism: row.mechanism,
    clinicalAdvice: row.clinical_advice,
  }));

  const allergyMappings = await fetchAllergyMappings(
    db as Pool,
    universe.allergySnomedCodes.map((snomedCode) => ({ snomedCode })),
  );

  return { normalized, pairs, classRules, allergyMappings };
}

export function normalizedFor(ref: SafetyReference, input: MedicationInput): NormalizedMedication | null {
  return ref.normalized.get(normalizedKey(input)) ?? null;
}

/** Same rules as `checkDrugDrugInteraction`: pair first; else the most severe class rule, either orientation. */
export function interactionBetween(
  ref: SafetyReference,
  a: { rxcui: string; atcClasses: string[] },
  b: { rxcui: string; atcClasses: string[] },
): InteractionResult | null {
  if (a.rxcui === b.rxcui) return null;
  const pair = ref.pairs.get(pairKey(a.rxcui, b.rxcui));
  if (pair) return pair;
  if (a.atcClasses.length === 0 || b.atcClasses.length === 0) return null;

  const has = (codes: string[], cls: string) => codes.some((c) => c.startsWith(cls));
  let best: ClassRule | null = null;
  for (const rule of ref.classRules) {
    const fires =
      (has(a.atcClasses, rule.atcClassA) && has(b.atcClasses, rule.atcClassB)) ||
      (has(a.atcClasses, rule.atcClassB) && has(b.atcClasses, rule.atcClassA));
    if (fires && (!best || SEVERITY_RANK[rule.severity] < SEVERITY_RANK[best.severity])) best = rule;
  }
  if (!best) return null;
  return {
    severity: best.severity,
    mechanism: best.mechanism,
    clinicalAdvice: best.clinicalAdvice,
    matchType: 'CLASS',
    matchedClasses: { atcClassA: best.atcClassA, atcClassB: best.atcClassB },
  };
}
```

- [ ] **Step 7: Create `pipeline/safety.ts`**

```ts
import type { PatientContext } from '../../confidence/types';
import { DdiCandidate, buildDrugDrugFinding, toEngineDrug } from '../../medications/ddi-pass';
import { matchDrugAllergyAgainstMappings } from '../../medications/ddi-engine';
import { SafetyReference, interactionBetween, normalizedFor } from '../../medications/safety-reference';
import type { NormalizedMedication } from '../../medications/types';
import type { SafetyUnavailable, ScopedFinding } from './types';

export interface SafetyOutcome {
  findings: ScopedFinding[];
  suppressed: Set<string>;
  unavailable: SafetyUnavailable[];
}

/**
 * Stage 5 — PATIENT scope (spec C3). Each candidate against the patient's
 * medications and allergies. A drug that cannot be normalised is REPORTED
 * (D14), never silently skipped.
 */
export function patientSafety(ref: SafetyReference, candidates: DdiCandidate[], patient: PatientContext): SafetyOutcome {
  const findings: ScopedFinding[] = [];
  const suppressed = new Set<string>();
  const unavailable: SafetyUnavailable[] = [];

  const patientMeds: NormalizedMedication[] = [];
  for (const m of patient.medications ?? []) {
    const drugName = m.display ?? m.code;
    const norm = normalizedFor(ref, { text: drugName, system: m.system, code: m.code });
    if (norm) patientMeds.push(norm);
    else unavailable.push({ drugName, source: 'PATIENT_MEDICATION' });
  }

  for (const c of candidates) {
    const norm = normalizedFor(ref, { text: c.drugName, system: c.system, code: c.code });
    if (!norm) {
      unavailable.push({ nodeId: c.recommendationId, drugName: c.drugName, source: 'CANDIDATE' });
      continue;
    }
    const drug = toEngineDrug(norm);

    for (const pm of patientMeds) {
      const f = buildDrugDrugFinding(c, norm, interactionBetween(ref, drug, toEngineDrug(pm)), {
        kind: 'PATIENT_MEDICATION', rxcui: pm.ingredientRxcui, name: pm.ingredientName,
      });
      if (!f) continue;
      findings.push({ ...f, scope: 'PATIENT' });
      if (f.action === 'SUPPRESS') suppressed.add(c.recommendationId);
    }

    for (const hit of matchDrugAllergyAgainstMappings(drug, ref.allergyMappings)) {
      findings.push({
        recommendationId: c.recommendationId,
        drugName: c.drugName,
        action: 'SUPPRESS',
        severity: hit.severity,
        category: 'ALLERGY',
        mechanism: null,
        clinicalAdvice: `Drug class ${hit.matchedDrugAtcClass} matches patient allergy "${hit.snomedDisplay}"`,
        source: { kind: 'PATIENT_ALLERGY', snomedCode: hit.snomedCode, snomedDisplay: hit.snomedDisplay },
        meta: c.meta,
        scope: 'PATIENT',
      });
      suppressed.add(c.recommendationId);
    }
  }

  return { findings, suppressed, unavailable };
}

/** Stage 6 — SET scope, ROOT only (spec C3). Every candidate pair; no same-pathway skip. */
export function pairSafety(ref: SafetyReference, candidates: DdiCandidate[]): { findings: ScopedFinding[]; suppressed: Set<string> } {
  const findings: ScopedFinding[] = [];
  const suppressed = new Set<string>();
  const norms = candidates
    .map((c) => ({ c, norm: normalizedFor(ref, { text: c.drugName, system: c.system, code: c.code }) }))
    .filter((x): x is { c: DdiCandidate; norm: NormalizedMedication } => x.norm !== null);

  for (let i = 0; i < norms.length; i++) {
    for (let j = i + 1; j < norms.length; j++) {
      const a = norms[i];
      const b = norms[j];
      const result = interactionBetween(ref, toEngineDrug(a.norm), toEngineDrug(b.norm));
      const fA = buildDrugDrugFinding(a.c, a.norm, result, { kind: 'OTHER_RECOMMENDATION', recommendationId: b.c.recommendationId, drugName: b.c.drugName });
      const fB = buildDrugDrugFinding(b.c, b.norm, result, { kind: 'OTHER_RECOMMENDATION', recommendationId: a.c.recommendationId, drugName: a.c.drugName });
      for (const f of [fA, fB]) {
        if (!f) continue;
        findings.push({ ...f, scope: 'SET' });
        if (f.action === 'SUPPRESS') suppressed.add(f.recommendationId);
      }
    }
  }
  return { findings, suppressed };
}
```

- [ ] **Step 8: Run the tests, the existing DDI tests, and the typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-safety.test.ts src/__tests__/ddi-pass-single-pathway.test.ts src/__tests__/ddi-multi-pathway.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: all PASS; typecheck clean.

**Falsify:** in `patientSafety`, temporarily replace the `unavailable.push(...)` for candidates with
`continue;`. The D14 test must fail. Restore it.

- [ ] **Step 9: Commit**

```bash
git -C $W add apps/pathway-service/src/services/medications apps/pathway-service/src/services/resolution/pipeline apps/pathway-service/src/__tests__/pipeline-safety.test.ts
git -C $W commit -m "feat(pathway-service): pure safety over a preloaded reference

loadSafetyReference reads normalisation, pair, class and allergy rows once;
patientSafety and pairSafety evaluate over them without queries, report
unnormalised medications instead of skipping them (D14), and scope findings
PATIENT or SET (C3).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 3: Observation provider

**Files:**
- Create: `apps/pathway-service/src/services/resolution/dotted-path.ts`
- Modify: `apps/pathway-service/src/resolvers/helpers/resolution-context.ts:399-412` (use the shared helper)
- Create: `apps/pathway-service/src/services/resolution/pipeline/observations.ts`
- Test: `apps/pathway-service/src/__tests__/pipeline-observations.test.ts`

**Interfaces:**
- Consumes: `LlmGateEvaluator`, `LlmGateVerdict` (`gate-evaluator.ts:1518-1532`);
  `LLMGateInput`, `LLMGateOutput` (`llm/llm-gate-client.ts`).
- Produces:
  - `resolveDottedPath(root: unknown, path: string): unknown`
  - `narrativeFor(gate: GateProperties, patient: PatientContext): string`
  - `observationKey(gate: GateProperties, gateId: string, narrative: string, model: string): ObservationKey`
  - `interface ObservationProvider { evaluator: LlmGateEvaluator; used: Set<ObservationKey> }`
  - `replayObservations(frozen: Map<ObservationKey, LlmObservation>, model: string): ObservationProvider`
  - `type LlmClient = (input: LLMGateInput) => Promise<LLMGateOutput>`
  - `liveObservations(session: Map<ObservationKey, LlmObservation>, request: Map<ObservationKey, LlmObservation>, client: LlmClient | null, model: string, now?: () => string): ObservationProvider`

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/pipeline-observations.test.ts`:

```ts
import { liveObservations, observationKey, replayObservations } from '../services/resolution/pipeline/observations';
import { DefaultBehavior, GateProperties, GateType } from '../services/resolution/types';
import type { LlmObservation } from '../services/resolution/pipeline/types';

const gate: GateProperties = {
  title: 'Urgency',
  gate_type: GateType.LLM_TEXT_ANALYSIS,
  default_behavior: DefaultBehavior.SKIP,
  prompt: 'Is this urgent?',
  input_attribute: 'freeformData.narrative',
  branches: [
    { name: 'urgent', description: 'same-day care' },
    { name: 'routine', description: 'can wait', is_safe_default: true },
  ],
  confidence_threshold: 0.75,
};
const patient = (narrative: string) =>
  ({ patientId: 'p', conditionCodes: [], medications: [], labResults: [], allergies: [], freeformData: { narrative } }) as never;
const output = { chosenBranch: 'urgent', confidence: 0.95, reasoning: 'chest pain', rawResponse: {}, model: 'm1', latencyMs: 5 };

describe('observationKey', () => {
  const base = observationKey(gate, 'g', 'chest pain', 'm1');

  it('changes with prompt, branches, input attribute, narrative, model and gate id', () => {
    expect(observationKey({ ...gate, prompt: 'Other?' }, 'g', 'chest pain', 'm1')).not.toBe(base);
    expect(observationKey({ ...gate, branches: [gate.branches![0]] }, 'g', 'chest pain', 'm1')).not.toBe(base);
    expect(observationKey({ ...gate, input_attribute: 'freeformData.hpi' }, 'g', 'chest pain', 'm1')).not.toBe(base);
    expect(observationKey(gate, 'g', 'cough', 'm1')).not.toBe(base);
    expect(observationKey(gate, 'g', 'chest pain', 'm2')).not.toBe(base);
    expect(observationKey(gate, 'h', 'chest pain', 'm1')).not.toBe(base);
  });

  it('ignores confidence_threshold, which is applied after acquisition', () => {
    expect(observationKey({ ...gate, confidence_threshold: 0.5 }, 'g', 'chest pain', 'm1')).toBe(base);
  });
});

describe('replayObservations', () => {
  it('returns a recorded verdict and marks it used; otherwise UNAVAILABLE', async () => {
    const key = observationKey(gate, 'g', 'chest pain', 'm1');
    const obs: LlmObservation = { key, gateId: 'g', chosenBranch: 'urgent', confidence: 0.95, reasoning: 'r', model: 'm1', acquiredAt: 't' };
    const provider = replayObservations(new Map([[key, obs]]), 'm1');

    await expect(provider.evaluator(gate, 'g', patient('chest pain'))).resolves.toEqual({ chosenBranch: 'urgent', confidence: 0.95, reasoning: 'r' });
    expect([...provider.used]).toEqual([key]);
    await expect(provider.evaluator(gate, 'g', patient('cough'))).resolves.toMatchObject({ failed: true });
  });
});

describe('liveObservations', () => {
  it('uses a session observation without calling the client', async () => {
    const key = observationKey(gate, 'g', 'chest pain', 'm1');
    const client = jest.fn().mockResolvedValue(output);
    const session = new Map([[key, { key, gateId: 'g', chosenBranch: 'routine', confidence: 0.9, reasoning: 's', model: 'm1', acquiredAt: 't' }]]);
    const verdict = await liveObservations(session, new Map(), client, 'm1').evaluator(gate, 'g', patient('chest pain'));

    expect(verdict.chosenBranch).toBe('routine');
    expect(client).not.toHaveBeenCalled();
  });

  it('reuses a request observation across providers (a retried attempt) and calls once', async () => {
    const client = jest.fn().mockResolvedValue(output);
    const request = new Map();
    await liveObservations(new Map(), request, client, 'm1', () => 't').evaluator(gate, 'g', patient('chest pain'));
    await liveObservations(new Map(), request, client, 'm1', () => 't').evaluator(gate, 'g', patient('chest pain'));

    expect(client).toHaveBeenCalledTimes(1);
    expect(request.size).toBe(1);
  });

  it('returns UNAVAILABLE on failure or no client, and records nothing', async () => {
    const request = new Map();
    const failing = jest.fn().mockRejectedValue(new Error('timeout'));
    await expect(liveObservations(new Map(), request, failing, 'm1').evaluator(gate, 'g', patient('x'))).resolves.toMatchObject({ failed: true });
    await expect(liveObservations(new Map(), request, null, 'm1').evaluator(gate, 'g', patient('x'))).resolves.toMatchObject({ failed: true });
    expect(request.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-observations.test.ts`
Expected: FAIL with `Cannot find module '../services/resolution/pipeline/observations'`.

- [ ] **Step 3: Share `resolveDottedPath`**

Create `apps/pathway-service/src/services/resolution/dotted-path.ts`:

```ts
/**
 * Walk a dotted path into a JSON bag. Returns undefined if any segment is
 * missing. Used to resolve a gate's `input_attribute` against the patient
 * narrative (e.g. `freeformData.narrative.chief_complaint`).
 */
export function resolveDottedPath(root: unknown, path: string): unknown {
  if (!path) return undefined;
  let cursor: unknown = root;
  for (const segment of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}
```

In `resolution-context.ts`, delete lines 399–412 (the JSDoc and the private `resolveDottedPath`)
and add to the imports:
`import { resolveDottedPath } from '../../services/resolution/dotted-path';`

- [ ] **Step 4: Create `pipeline/observations.ts`**

```ts
import type { PatientContext } from '../../confidence/types';
import type { LLMGateInput, LLMGateOutput } from '../../llm/llm-gate-client';
import type { LlmGateEvaluator, LlmGateVerdict } from '../gate-evaluator';
import type { GateProperties } from '../types';
import { resolveDottedPath } from '../dotted-path';
import { hashOf } from './canonical';
import type { LlmObservation, ObservationKey } from './types';

export type LlmClient = (input: LLMGateInput) => Promise<LLMGateOutput>;

export interface ObservationProvider {
  evaluator: LlmGateEvaluator;
  /** Keys whose observation this evaluation consumed; the commit persists exactly these. */
  used: Set<ObservationKey>;
}

/** The narrative an LLM gate reads, exactly as the resolver's evaluator reads it. */
export function narrativeFor(gate: GateProperties, patient: PatientContext): string {
  const raw = resolveDottedPath(patient, gate.input_attribute ?? '');
  return typeof raw === 'string' ? raw : '';
}

/**
 * The semantic request (C1, D10). `confidence_threshold` is deliberately
 * absent: it is applied to the verdict after acquisition.
 */
export function observationKey(gate: GateProperties, gateId: string, narrative: string, model: string): ObservationKey {
  return hashOf({
    gateId,
    prompt: gate.prompt ?? gate.title,
    branches: (gate.branches ?? []).map((b) => ({ name: b.name, description: b.description })),
    inputAttribute: gate.input_attribute ?? '',
    narrative,
    model,
  });
}

/** Never a clinical false: the gate takes its safe default, tentatively (D3). */
const unavailable = (reason: string): LlmGateVerdict => ({
  chosenBranch: '', confidence: 0, reasoning: reason, failed: true, errorMessage: reason,
});

const verdictOf = (o: LlmObservation): LlmGateVerdict => ({
  chosenBranch: o.chosenBranch, confidence: o.confidence, reasoning: o.reasoning,
});

export function replayObservations(frozen: Map<ObservationKey, LlmObservation>, model: string): ObservationProvider {
  const used = new Set<ObservationKey>();
  return {
    used,
    evaluator: async (gate, gateId, patient) => {
      const key = observationKey(gate, gateId, narrativeFor(gate, patient), model);
      const obs = frozen.get(key);
      if (!obs) return unavailable('UNAVAILABLE: no recorded observation');
      used.add(key);
      return verdictOf(obs);
    },
  };
}

export function liveObservations(
  session: Map<ObservationKey, LlmObservation>,
  request: Map<ObservationKey, LlmObservation>,
  client: LlmClient | null,
  model: string,
  now: () => string = () => new Date().toISOString(),
): ObservationProvider {
  const used = new Set<ObservationKey>();
  const failedThisAttempt = new Set<ObservationKey>();
  return {
    used,
    evaluator: async (gate, gateId, patient) => {
      const narrative = narrativeFor(gate, patient);
      const key = observationKey(gate, gateId, narrative, model);
      const known = session.get(key) ?? request.get(key);
      if (known) {
        used.add(key);
        return verdictOf(known);
      }
      if (!client || failedThisAttempt.has(key)) return unavailable('UNAVAILABLE: no LLM client or call failed');
      try {
        const out = await client({
          prompt: gate.prompt ?? gate.title,
          narrative,
          branches: (gate.branches ?? []).map((b) => ({ name: b.name, description: b.description })),
        });
        const obs: LlmObservation = {
          key, gateId, chosenBranch: out.chosenBranch, confidence: out.confidence,
          reasoning: out.reasoning, model: out.model, acquiredAt: now(),
        };
        request.set(key, obs);
        used.add(key);
        return verdictOf(obs);
      } catch (err) {
        failedThisAttempt.add(key);
        return unavailable(`UNAVAILABLE: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
```

- [ ] **Step 5: Run the tests and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-observations.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS; typecheck clean. The `resolveDottedPath` move is covered by Task 9's full-suite
run.

- [ ] **Step 6: Commit**

```bash
git -C $W add apps/pathway-service/src/services/resolution/dotted-path.ts apps/pathway-service/src/resolvers/helpers/resolution-context.ts apps/pathway-service/src/services/resolution/pipeline/observations.ts apps/pathway-service/src/__tests__/pipeline-observations.test.ts
git -C $W commit -m "feat(pathway-service): replayable LLM observation provider

Observations cross an explicit boundary (C1, D10): keys cover prompt,
branches, input attribute, narrative and model; replay never calls out;
live reuses session and request observations across retries; failures
are UNAVAILABLE and never recorded.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 4: Overrides as traversal input

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/traversal-engine.ts:488-577`
- Test: `apps/pathway-service/src/__tests__/pipeline-traversal-overrides.test.ts`

**Interfaces:**
- Consumes: `ProviderOverride`, `OverrideAction` (`services/resolution/types.ts:38`).
- Produces:
  `TraversalEngine.traverse(graphContext, patientContext, gateAnswers, overrides: Map<string, ProviderOverride> = new Map()): Promise<TraversalResult>`

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/pipeline-traversal-overrides.test.ts`:

```ts
import { TraversalEngine } from '../services/resolution/traversal-engine';
import { makeEvaluationTemporalContext } from '../services/resolution/temporal/evaluation-context';
import { AnswerType, DefaultBehavior, GateType, NodeStatus, OverrideAction, ProviderOverride } from '../services/resolution/types';
import type { GraphEdge, GraphNode } from '../services/confidence/types';
import { REFERENCE_PATIENT, makeGraphContext } from './fixtures/reference-patient-context';

const node = (id: string, type: string, props: Record<string, unknown> = {}): GraphNode =>
  ({ id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } });
const edge = (s: string, t: string): GraphEdge => ({ id: `${s}->${t}`, edgeType: 'HAS_CHILD', sourceId: s, targetId: t, properties: {} });

function engine(): TraversalEngine {
  return new TraversalEngine(
    { computeNodeConfidence: async (n: GraphNode) => ({ nodeIdentifier: n.nodeIdentifier, nodeType: n.nodeType, confidence: (n.properties.score as number) ?? 0.9, breakdown: [], propagationInfluences: [] }) } as never,
    { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    makeEvaluationTemporalContext({ evaluationAsOf: '2026-09-15T12:00:00.000Z', temporalPolicyVersion: 'legacy-v0' }),
    {},
    [],
    new Map(),
  );
}
const include = (originalStatus: NodeStatus): ProviderOverride =>
  ({ action: OverrideAction.INCLUDE, reason: 'clinician', originalStatus, originalConfidence: 0.1 });

describe('traverse with overrides as input', () => {
  it('an INCLUDE override pins a below-threshold medication and its children still traverse', async () => {
    const g = makeGraphContext(
      [node('root', 'Pathway'), node('step', 'Step'), node('med', 'Medication', { score: 0.1 }), node('code', 'CodeEntry')],
      [edge('root', 'step'), edge('step', 'med'), edge('med', 'code')],
    );
    const r = await engine().traverse(g, REFERENCE_PATIENT, new Map(), new Map([['med', include(NodeStatus.EXCLUDED)]]));

    expect(r.resolutionState.get('med')).toMatchObject({ status: NodeStatus.INCLUDED, parentNodeId: 'step', depth: 2 });
    expect(r.resolutionState.get('med')!.providerOverride!.action).toBe(OverrideAction.INCLUDE);
    expect(r.resolutionState.get('code')!.status).toBe(NodeStatus.INCLUDED);
  });

  it('a closing gate sweeps past a held Step without rewriting it', async () => {
    const g = makeGraphContext(
      [node('root', 'Pathway'),
       node('q', 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: 'q?' }),
       node('step', 'Step'), node('med', 'Medication')],
      [edge('root', 'q'), edge('q', 'step'), edge('step', 'med')],
    );
    const r = await engine().traverse(g, REFERENCE_PATIENT, new Map([['q', { booleanValue: false }]]), new Map([['step', include(NodeStatus.GATED_OUT)]]));

    expect(r.resolutionState.get('q')!.status).toBe(NodeStatus.GATED_OUT);
    expect(r.resolutionState.get('step')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('med')!.status).toBe(NodeStatus.GATED_OUT);
  });

  it('no overrides behaves exactly as before', async () => {
    const g = makeGraphContext([node('root', 'Pathway'), node('step', 'Step'), node('med', 'Medication', { score: 0.1 })], [edge('root', 'step'), edge('step', 'med')]);
    const withDefault = await engine().traverse(g, REFERENCE_PATIENT, new Map());
    const withEmpty = await engine().traverse(g, REFERENCE_PATIENT, new Map(), new Map());
    expect([...withEmpty.resolutionState]).toEqual([...withDefault.resolutionState]);
    expect(withDefault.resolutionState.get('med')!.status).toBe(NodeStatus.EXCLUDED);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-traversal-overrides.test.ts`
Expected: FAIL. The first test's medication is `EXCLUDED`, because the fourth argument is ignored.

- [ ] **Step 3: Implement**

In `traversal-engine.ts`:

1. Add `OverrideAction` and `ProviderOverride` to the import list from `./types` (lines 16–36).
2. Change the signature at line 488:

```ts
  async traverse(
    graphContext: GraphContext,
    patientContext: PatientContext,
    gateAnswers: Map<string, GateAnswer>,
    overrides: Map<string, ProviderOverride> = new Map(),
  ): Promise<TraversalResult> {
```

3. Directly after `const queue: BfsEntry[] = [...]` (line 524), insert:

```ts
    // Provider overrides are INPUTS (spec §1 rule 3). Each is pre-seeded HELD,
    // exactly as the incremental path held a stored override: the decision
    // about THIS node stands, a closing sweep descends past it without
    // rewriting it, and the walk opens its children when it arrives.
    for (const [id, override] of overrides) {
      const n = graphContext.getNode(id);
      if (!n) continue;
      resolutionState.set(id, {
        nodeId: id,
        nodeType: n.nodeType,
        title: nodeTitle(n),
        status: override.action === OverrideAction.INCLUDE ? NodeStatus.INCLUDED : NodeStatus.EXCLUDED,
        confidence: override.originalConfidence,
        confidenceBreakdown: [],
        providerOverride: override,
        depth: 0,
        properties: n.properties,
      });
      overrideHeld.add(id);
    }
```

4. In the BFS loop, insert directly **before** `// Memoization: skip already-resolved nodes`
   (line 565):

```ts
      // Arrival at a held override: record where the walk reached it, then open
      // its children. Mirrors resolveIncrementally's held arrival.
      if (overrideHeld.has(nodeIdentifier)) {
        overrideHeld.delete(nodeIdentifier);
        const held = resolutionState.get(nodeIdentifier)!;
        held.parentNodeId = parentNodeId;
        held.depth = depth;
        for (const e of graphContext.outgoingEdges(nodeIdentifier)) {
          if (!resolutionState.has(e.targetId) || provisional.has(e.targetId) || overrideHeld.has(e.targetId)) {
            queue.push({ nodeIdentifier: e.targetId, parentNodeId: nodeIdentifier, depth: depth + 1 });
          }
        }
        continue;
      }
```

- [ ] **Step 4: Run the tests (new + existing traversal suites) and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-traversal-overrides.test.ts src/__tests__/traversal-engine.test.ts src/__tests__/eager-reachability.test.ts src/__tests__/eager-disposition-parity.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS; typecheck clean.

**Falsify:** delete the arrival block from step 3.4. The first test must fail, because `code` is
absent. Restore it.

- [ ] **Step 5: Commit**

```bash
git -C $W add apps/pathway-service/src/services/resolution/traversal-engine.ts apps/pathway-service/src/__tests__/pipeline-traversal-overrides.test.ts
git -C $W commit -m "feat(pathway-service): accept provider overrides as traversal input

traverse pre-seeds each override as held and opens its children on
arrival, so a full traversal honours overrides the way the incremental
path did. The parameter defaults to no overrides.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 5: Environment snapshot loader

**Files:**
- Create: `apps/pathway-service/src/services/resolution/pipeline/load-env.ts`
- Test: `apps/pathway-service/src/__tests__/pipeline-load-env.test.ts`

**Interfaces:**
- Consumes:
  - `buildResolutionContext(pool, pathwayId): Promise<ResolutionContext>` (`resolvers/helpers/resolution-context.ts:291`)
  - `ConfidenceEngine.loadScoringConfig` (Task 1)
  - `loadSafetyReference`, `normalizedKey` (Task 2)
  - `loadLLMGateConfig` (`llm/llm-gate-client.ts:86`)
- Produces:
  - `interface EvaluationEnv { resolution: ResolutionContext; scoring: ScoringConfig; safety: SafetyReference; graphFingerprint: string; envFingerprint: string; llmModel: string | null; unnormalized: string[] }`
  - `interface CandidateUniverse { patient: PatientContext; writeIns?: string[] }`
  - `medicationName(node: { nodeIdentifier: string; properties?: Record<string, unknown> }): string`
  - `graphFingerprintOf(ctx: ResolutionContext): string`
  - `loadEvaluationEnv(pool: Pool, pathwayId: string, universe: CandidateUniverse): Promise<EvaluationEnv>`

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/pipeline-load-env.test.ts`:

```ts
jest.mock('../resolvers/helpers/resolution-context', () => {
  const actual = jest.requireActual('../resolvers/helpers/resolution-context');
  return { ...actual, buildResolutionContext: jest.fn() };
});
jest.mock('../services/medications/safety-reference', () => {
  const actual = jest.requireActual('../services/medications/safety-reference');
  return { ...actual, loadSafetyReference: jest.fn() };
});
jest.mock('../services/llm/llm-gate-client', () => ({ loadLLMGateConfig: () => ({ model: 'm1' }) }));

import { buildGraphContext, buildResolutionContext } from '../resolvers/helpers/resolution-context';
import { loadSafetyReference } from '../services/medications/safety-reference';
import { graphFingerprintOf, loadEvaluationEnv } from '../services/resolution/pipeline/load-env';

const nodes = [
  { id: '1', nodeIdentifier: 'root', nodeType: 'Pathway', properties: {} },
  { id: '2', nodeIdentifier: 'med', nodeType: 'Medication', properties: { name: 'Labetalol' } },
];
const edges = [{ id: 'e', edgeType: 'HAS_CHILD', sourceId: 'root', targetId: 'med', properties: {} }];
const scoring = { adminEvidenceEntries: [], weightMatrix: {}, nodeWeightMap: new Map(), propagationOverrides: new Map(), thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6, scope: 'SYSTEM_DEFAULT' } };
const rctx = (threshold = 0.6, order = nodes) => ({
  graphContext: buildGraphContext(order as never, edges as never), edges, signals: [],
  thresholds: { autoResolveThreshold: 0.85, suggestThreshold: threshold },
  confidenceEngine: { loadScoringConfig: jest.fn().mockResolvedValue(scoring) },
  codeMap: new Map(), temporalDefaults: {},
});
const safety = { normalized: new Map([['labetalol||', { ingredientRxcui: '6185', ingredientName: 'labetalol', atcClasses: ['C07AG01'] }]]), pairs: new Map(), classRules: [], allergyMappings: [] };
const patient = { patientId: 'p', conditionCodes: [], labResults: [],
  medications: [{ code: '999', system: 'RxNorm', display: 'Mysterydrug' }],
  allergies: [{ code: '91936005', system: 'SNOMED' }, { code: '7980', system: 'RXNORM' }] };

function db() {
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
  return { client, pool: { connect: jest.fn().mockResolvedValue(client) } };
}

beforeEach(() => {
  (buildResolutionContext as jest.Mock).mockReset().mockResolvedValue(rctx());
  (loadSafetyReference as jest.Mock).mockReset().mockResolvedValue(safety);
});

describe('loadEvaluationEnv', () => {
  it('reads everything on one client inside a read-only repeatable-read snapshot', async () => {
    const { client, pool } = db();
    const env = await loadEvaluationEnv(pool as never, 'pw', { patient: patient as never, writeIns: ['Tinidazole'] });

    expect(client.query.mock.calls[0][0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(client.query.mock.calls.at(-1)![0]).toBe('COMMIT');
    expect((buildResolutionContext as jest.Mock).mock.calls[0][0]).toBe(client);
    expect((loadSafetyReference as jest.Mock).mock.calls[0]).toEqual([client, {
      medications: [{ text: 'Labetalol' }, { text: 'Mysterydrug', system: 'RxNorm', code: '999' }, { text: 'Tinidazole' }],
      allergySnomedCodes: ['91936005'],
    }]);
    expect(client.release).toHaveBeenCalled();
    expect(env.llmModel).toBe('m1');
    expect(env.unnormalized).toEqual(['Mysterydrug', 'Tinidazole']);
  });

  it('rolls back and releases on failure', async () => {
    const { client, pool } = db();
    (buildResolutionContext as jest.Mock).mockRejectedValue(new Error('age down'));

    await expect(loadEvaluationEnv(pool as never, 'pw', { patient: patient as never })).rejects.toThrow('age down');
    expect(client.query.mock.calls.map((c) => c[0])).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  it('graph fingerprint ignores node order; env fingerprint tracks configuration', async () => {
    expect(graphFingerprintOf(rctx(0.6, [...nodes].reverse()) as never)).toBe(graphFingerprintOf(rctx() as never));

    const a = await loadEvaluationEnv(db().pool as never, 'pw', { patient: patient as never });
    (buildResolutionContext as jest.Mock).mockResolvedValue(rctx(0.7));
    const b = await loadEvaluationEnv(db().pool as never, 'pw', { patient: patient as never });
    expect(b.graphFingerprint).toBe(a.graphFingerprint);
    expect(b.envFingerprint).not.toBe(a.envFingerprint);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-load-env.test.ts`
Expected: FAIL with `Cannot find module '../services/resolution/pipeline/load-env'`.

- [ ] **Step 3: Create `pipeline/load-env.ts`**

```ts
import { Pool } from 'pg';
import { buildResolutionContext } from '../../../resolvers/helpers/resolution-context';
import type { ResolutionContext } from '../../../resolvers/helpers/resolution-context';
import type { ScoringConfig } from '../../confidence/confidence-engine';
import type { PatientContext } from '../../confidence/types';
import { loadLLMGateConfig } from '../../llm/llm-gate-client';
import { SafetyReference, loadSafetyReference, normalizedKey } from '../../medications/safety-reference';
import type { MedicationInput } from '../../medications/types';
import { hashOf } from './canonical';

/** Everything evaluation reads, from one snapshot (spec C4). */
export interface EvaluationEnv {
  resolution: ResolutionContext;
  scoring: ScoringConfig;
  safety: SafetyReference;
  graphFingerprint: string;
  envFingerprint: string;
  llmModel: string | null;
  /** Medication texts with no normalised row — for non-blocking pre-warm (plan 03). */
  unnormalized: string[];
}

export interface CandidateUniverse {
  patient: PatientContext;
  /** Provider write-ins (CUSTOM_OVERRIDE) recorded in conflict_resolutions. */
  writeIns?: string[];
}

/** The drug name DDI reads for a Medication node — identical to applyDdiToResolutionState. */
export function medicationName(node: { nodeIdentifier: string; properties?: Record<string, unknown> }): string {
  return String(node.properties?.name ?? node.properties?.title ?? node.nodeIdentifier);
}

export function graphFingerprintOf(ctx: ResolutionContext): string {
  const byKey = <T>(key: (x: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  const nodes = ctx.graphContext.allNodes
    .map((n) => ({ id: n.nodeIdentifier, type: n.nodeType, properties: n.properties }))
    .sort(byKey((n) => n.id));
  const edges = ctx.edges
    .map((e) => ({ source: e.sourceId, target: e.targetId, type: e.edgeType, properties: e.properties }))
    .sort(byKey((e) => `${e.source}|${e.target}|${e.type}`));
  return hashOf({ nodes, edges });
}

export async function loadEvaluationEnv(pool: Pool, pathwayId: string, universe: CandidateUniverse): Promise<EvaluationEnv> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const db = client as unknown as Pool;

    const resolution = await buildResolutionContext(db, pathwayId);
    const scoring = await resolution.confidenceEngine.loadScoringConfig({
      pool: db,
      pathwayId,
      nodes: resolution.graphContext.allNodes,
      signalDefinitions: resolution.signals,
    });

    const medications: MedicationInput[] = [
      ...resolution.graphContext.allNodes.filter((n) => n.nodeType === 'Medication').map((n) => ({ text: medicationName(n) })),
      ...universe.patient.medications.map((m) => ({ text: m.display ?? m.code, system: m.system, code: m.code })),
      ...(universe.writeIns ?? []).map((text) => ({ text })),
    ];
    const safety = await loadSafetyReference(db, {
      medications,
      allergySnomedCodes: universe.patient.allergies.filter((a) => a.system === 'SNOMED').map((a) => a.code),
    });

    await client.query('COMMIT');

    const graphFingerprint = graphFingerprintOf(resolution);
    const llmModel = loadLLMGateConfig()?.model ?? null;
    const unnormalized = [...new Set(medications.filter((m) => !safety.normalized.has(normalizedKey(m))).map((m) => m.text))];
    const envFingerprint = hashOf({
      graphFingerprint,
      signals: resolution.signals,
      thresholds: resolution.thresholds,
      codeMap: resolution.codeMap,
      temporalDefaults: resolution.temporalDefaults,
      scoring,
      safety,
      llmModel,
    });

    return { resolution, scoring, safety, graphFingerprint, envFingerprint, llmModel, unnormalized };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run the test and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-load-env.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git -C $W add apps/pathway-service/src/services/resolution/pipeline/load-env.ts apps/pathway-service/src/__tests__/pipeline-load-env.test.ts
git -C $W commit -m "feat(pathway-service): evaluation environment snapshot loader

loadEvaluationEnv reads graph, scoring configuration and the safety
reference for the candidate universe (graph medications, patient
medications, write-ins) in one read-only repeatable-read transaction, and
fingerprints the graph and the environment (C4).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 6: Findings, disposition layers, readiness

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/types.ts:45-84` (add C2 fields)
- Create:
  - `apps/pathway-service/src/services/resolution/pipeline/findings.ts`
  - `apps/pathway-service/src/services/resolution/pipeline/disposition.ts`
  - `apps/pathway-service/src/services/resolution/pipeline/readiness.ts`
- Test: `apps/pathway-service/src/__tests__/pipeline-readiness.test.ts`

**Interfaces:**
- Consumes: `findUnmetPrerequisites(startNodeId, patientContext, graphContext)`
  (`services/resolution/prerequisites.ts:82`); `ddiSuppressionReason(findings, recommendationId)`
  (Task 2 export).
- Produces:
  - `interface NodeEligibility { status: NodeStatus; reason?: string; decidedBy: 'traversal' | 'override' }`
  - `interface NodeDisposition { status: NodeStatus; withheldBy?: 'safety' | 'conflict'; findingIds?: string[]; reason?: string }`
  - `catchUpItemsFor(state: ResolutionState, patient: PatientContext, graph: GraphContext, pathwayId: string): CatchUpItem[]`
  - `gateContextFieldsOf(depMap: DependencyMap): Map<string, string[]>`
  - `medicationCandidates(state: ResolutionState): DdiCandidate[]`
  - `applyDisposition(state: ResolutionState, findings: ScopedFinding[]): ResolutionState`
  - `readinessOf(input: { state: ResolutionState; pendingQuestions: PendingQuestion[]; redFlags: RedFlag[]; unavailable: SafetyUnavailable[]; scope: EvaluationScope; isDegraded: boolean }): { ready: boolean; blockers: ScopedBlocker[]; status: 'ACTIVE' | 'DEGRADED' }`

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/pipeline-readiness.test.ts`:

```ts
import { applyDisposition, medicationCandidates } from '../services/resolution/pipeline/disposition';
import { readinessOf } from '../services/resolution/pipeline/readiness';
import { NodeResult, NodeStatus, OverrideAction, ResolutionState } from '../services/resolution/types';
import type { ScopedFinding } from '../services/resolution/pipeline/types';

const n = (nodeId: string, nodeType: string, status: NodeStatus, extra: Partial<NodeResult> = {}): NodeResult =>
  ({ nodeId, nodeType, title: nodeId, status, confidence: 0.9, confidenceBreakdown: [], depth: 1, properties: { name: nodeId }, ...extra });
const state = (...nodes: NodeResult[]): ResolutionState => new Map(nodes.map((x) => [x.nodeId, x]));
const base = { pendingQuestions: [], redFlags: [], unavailable: [], scope: 'ROOT' as const, isDegraded: false };
const allergy: ScopedFinding = {
  recommendationId: 'med', drugName: 'med', action: 'SUPPRESS', severity: 'SEVERE', category: 'ALLERGY',
  mechanism: null, clinicalAdvice: 'x', source: { kind: 'PATIENT_ALLERGY', snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin' }, scope: 'PATIENT',
};

describe('applyDisposition (C2)', () => {
  it('keeps eligibility and withholds by safety', () => {
    const out = applyDisposition(state(n('med', 'Medication', NodeStatus.INCLUDED)), [allergy]).get('med')!;
    expect(out.eligibility).toEqual({ status: NodeStatus.INCLUDED, reason: undefined, decidedBy: 'traversal' });
    expect(out.disposition).toMatchObject({ status: NodeStatus.EXCLUDED, withheldBy: 'safety' });
    expect(out.status).toBe(NodeStatus.EXCLUDED);
    expect(out.excludeReason).toContain('ALLERGY');
  });

  it('leaves non-included nodes and unrelated nodes unchanged; overrides are decidedBy override', () => {
    const s = applyDisposition(state(
      n('med', 'Medication', NodeStatus.EXCLUDED, { excludeReason: 'low' }),
      n('lab', 'LabTest', NodeStatus.INCLUDED, { providerOverride: { action: OverrideAction.INCLUDE, originalStatus: NodeStatus.EXCLUDED, originalConfidence: 0.1 } }),
    ), [allergy]);
    expect(s.get('med')!.disposition).toEqual({ status: NodeStatus.EXCLUDED });
    expect(s.get('med')!.excludeReason).toBe('low');
    expect(s.get('lab')!.eligibility!.decidedBy).toBe('override');
  });

  it('medicationCandidates lists included medications by the DDI name', () => {
    expect(medicationCandidates(state(n('m1', 'Medication', NodeStatus.INCLUDED), n('m2', 'Medication', NodeStatus.EXCLUDED), n('l', 'LabTest', NodeStatus.INCLUDED))))
      .toEqual([{ recommendationId: 'm1', drugName: 'm1', meta: { nodeType: 'Medication' } }]);
  });
});

describe('readinessOf (C3)', () => {
  const types = (r: ReturnType<typeof readinessOf>) => r.blockers.map((b) => `${b.scope}:${b.type}`).sort();

  it('ready when an action is included and nothing is open', () => {
    const r = readinessOf({ ...base, state: state(n('med', 'Medication', NodeStatus.INCLUDED)) });
    expect(r).toMatchObject({ ready: true, blockers: [], status: 'ACTIVE' });
  });

  it('completeness blockers: pending node, tentative question, red flag, timeout, unavailable safety data', () => {
    const r = readinessOf({
      ...base,
      state: state(n('med', 'Medication', NodeStatus.INCLUDED), n('q', 'Gate', NodeStatus.PENDING_QUESTION), n('llm', 'Gate', NodeStatus.INCLUDED), n('t', 'Step', NodeStatus.TIMEOUT)),
      pendingQuestions: [{ gateId: 'q', prompt: 'q', answerType: 'BOOLEAN' as never, affectedSubtreeSize: 0, estimatedImpact: 'low' },
        { gateId: 'llm', prompt: 'llm', answerType: 'SELECT' as never, affectedSubtreeSize: 0, estimatedImpact: 'low', tentative: true }],
      redFlags: [{ nodeId: 'dp', nodeTitle: 'dp', type: 'all_branches_excluded', description: 'x' }],
      unavailable: [{ drugName: 'Mysterydrug', source: 'PATIENT_MEDICATION' }],
    });
    expect(types(r)).toEqual([
      'COMPLETENESS:INCOMPLETE_RESOLUTION', 'COMPLETENESS:PENDING_GATE', 'COMPLETENESS:PENDING_GATE',
      'COMPLETENESS:SAFETY_DATA_UNAVAILABLE', 'COMPLETENESS:UNRESOLVED_RED_FLAG',
    ]);
    expect(r.status).toBe('DEGRADED');
  });

  it('EMPTY_PLAN is an OUTPUT blocker at ROOT only, judged on disposition', () => {
    const withheld = applyDisposition(state(n('med', 'Medication', NodeStatus.INCLUDED)), [allergy]);
    expect(types(readinessOf({ ...base, state: withheld }))).toEqual(['OUTPUT:EMPTY_PLAN']);
    expect(types(readinessOf({ ...base, scope: 'CONTRIBUTION', state: withheld }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-readiness.test.ts`
Expected: FAIL with `Cannot find module '../services/resolution/pipeline/disposition'`.

- [ ] **Step 3: Add the C2 types**

In `services/resolution/types.ts`, directly above `export interface NodeResult {` (line 45), add:

```ts
/** What the pathway decided about a node (spec C2). Graph dependencies read this. */
export interface NodeEligibility {
  status: NodeStatus;
  reason?: string;
  decidedBy: 'traversal' | 'override';
}

/** Whether the node is in the final plan, after safety and composition (spec C2). */
export interface NodeDisposition {
  status: NodeStatus;
  withheldBy?: 'safety' | 'conflict';
  findingIds?: string[];
  reason?: string;
}
```

Inside `NodeResult`, directly after `providerOverride?: ProviderOverride;` (line 79), add:

```ts
  /** Pipeline only (spec C2). Absent on results from the resolver paths plan 03 replaces. */
  eligibility?: NodeEligibility;
  disposition?: NodeDisposition;
```

- [ ] **Step 4: Create `pipeline/findings.ts`**

```ts
import type { GraphContext, PatientContext } from '../../confidence/types';
import type { CatchUpItem } from '../care-plan-merge';
import { findUnmetPrerequisites } from '../prerequisites';
import { DependencyMap, NodeStatus, ResolutionState } from '../types';

/** Catch-up items for every included Stage/Step — the multi-start computation, now for every evaluation. */
export function catchUpItemsFor(state: ResolutionState, patient: PatientContext, graph: GraphContext, pathwayId: string): CatchUpItem[] {
  const items: CatchUpItem[] = [];
  const seen = new Set<string>();
  for (const node of state.values()) {
    if (node.status !== NodeStatus.INCLUDED) continue;
    if (node.nodeType !== 'Stage' && node.nodeType !== 'Step') continue;
    for (const u of findUnmetPrerequisites(node.nodeId, patient, graph)) {
      if (seen.has(u.nodeId)) continue;
      seen.add(u.nodeId);
      items.push({ nodeId: u.nodeId, nodeType: u.nodeType, title: u.title, dependentNodeId: u.dependentNodeId, reason: u.reason, sourcePathwayId: pathwayId });
    }
  }
  return items;
}

/** `gateContextFields` as sorted arrays — the only part of the dependency map that survives (spec §1). */
export function gateContextFieldsOf(depMap: DependencyMap): Map<string, string[]> {
  return new Map([...depMap.gateContextFields].map(([gateId, fields]) => [gateId, [...fields].sort()]));
}
```

- [ ] **Step 5: Create `pipeline/disposition.ts`**

```ts
import type { DdiCandidate } from '../../medications/ddi-pass';
import { ddiSuppressionReason } from '../../medications/ddi-pass-single-pathway';
import { NodeStatus, ResolutionState } from '../types';
import { medicationName } from './load-env';
import type { ScopedFinding } from './types';

/**
 * Included medications, named exactly as the environment's candidate universe
 * names them (`medicationName`), so a snapshot row can never miss its
 * candidate.
 */
export function medicationCandidates(state: ResolutionState): DdiCandidate[] {
  return [...state.values()]
    .filter((n) => n.nodeType === 'Medication' && n.status === NodeStatus.INCLUDED)
    .map((n) => ({
      recommendationId: n.nodeId,
      drugName: medicationName({ nodeIdentifier: n.nodeId, properties: n.properties }),
      meta: { nodeType: n.nodeType },
    }));
}

const findingId = (f: ScopedFinding): string =>
  `${f.scope}|${f.category}|${f.source.kind}|${
    f.source.kind === 'PATIENT_MEDICATION' ? f.source.rxcui
      : f.source.kind === 'PATIENT_ALLERGY' ? f.source.snomedCode
        : f.source.recommendationId
  }`;

/**
 * Split each node into eligibility (what traversal decided) and disposition
 * (what the plan keeps). Only an INCLUDED node can be withheld; its original
 * explanation survives in `eligibility`.
 */
export function applyDisposition(state: ResolutionState, findings: ScopedFinding[]): ResolutionState {
  const suppressing = new Map<string, ScopedFinding[]>();
  for (const f of findings) {
    if (f.action !== 'SUPPRESS') continue;
    suppressing.set(f.recommendationId, [...(suppressing.get(f.recommendationId) ?? []), f]);
  }

  const out: ResolutionState = new Map();
  for (const [id, node] of state) {
    const eligibility = { status: node.status, reason: node.excludeReason, decidedBy: node.providerOverride ? 'override' as const : 'traversal' as const };
    const withheld = node.status === NodeStatus.INCLUDED ? suppressing.get(id) : undefined;
    const disposition = withheld
      ? { status: NodeStatus.EXCLUDED, withheldBy: 'safety' as const, findingIds: withheld.map(findingId).sort(), reason: ddiSuppressionReason(withheld, id) }
      : { status: node.status };
    out.set(id, { ...node, eligibility, disposition, status: disposition.status, excludeReason: disposition.reason ?? eligibility.reason });
  }
  return out;
}
```

`medicationName` resolves `properties.name ?? properties.title ?? nodeIdentifier`. That is
identical to `applyDdiToResolutionState`'s `properties.name ?? node.title`, because `node.title` is
`properties.title ?? nodeIdentifier` (`nodeTitle`, `traversal-engine.ts:194`).

- [ ] **Step 6: Create `pipeline/readiness.ts`**

```ts
import { ACTION_NODE_TYPES, NodeStatus, PendingQuestion, RedFlag, ResolutionState } from '../types';
import type { EvaluationScope, SafetyUnavailable, ScopedBlocker } from './types';

const INCOMPLETE = [NodeStatus.TIMEOUT, NodeStatus.CASCADE_LIMIT, NodeStatus.UNKNOWN];

/** Stage 7: one readiness rule set for every evaluation (spec §2, C3). */
export function readinessOf(input: {
  state: ResolutionState;
  pendingQuestions: PendingQuestion[];
  redFlags: RedFlag[];
  unavailable: SafetyUnavailable[];
  scope: EvaluationScope;
  isDegraded: boolean;
}): { ready: boolean; blockers: ScopedBlocker[]; status: 'ACTIVE' | 'DEGRADED' } {
  const blockers: ScopedBlocker[] = [];
  const pendingGates = new Set<string>();

  for (const node of input.state.values()) {
    if (node.status === NodeStatus.PENDING_QUESTION && (node.nodeType === 'Gate' || node.nodeType === 'DecisionPoint')) {
      pendingGates.add(node.nodeId);
      blockers.push({ scope: 'COMPLETENESS', type: 'PENDING_GATE', description: `"${node.title}" has an unanswered question`, relatedNodeIds: [node.nodeId] });
    }
    if (INCOMPLETE.includes(node.status)) {
      blockers.push({ scope: 'COMPLETENESS', type: 'INCOMPLETE_RESOLUTION', description: `"${node.title}" was never resolved (${node.status})`, relatedNodeIds: [node.nodeId] });
    }
  }
  // Open questions whose node is not PENDING — e.g. a tentative LLM gate, INCLUDED on its safe default (D3).
  for (const q of input.pendingQuestions) {
    if (pendingGates.has(q.gateId)) continue;
    pendingGates.add(q.gateId);
    blockers.push({ scope: 'COMPLETENESS', type: 'PENDING_GATE', description: `Open question: ${q.prompt}`, relatedNodeIds: [q.gateId] });
  }
  for (const flag of input.redFlags) {
    if (flag.acknowledged) continue;
    blockers.push({ scope: 'COMPLETENESS', type: 'UNRESOLVED_RED_FLAG', description: `Unresolved red flag: ${flag.description}`, relatedNodeIds: [flag.nodeId] });
  }
  const seenUnavailable = new Set<string>();
  for (const u of input.unavailable) {
    const k = `${u.source}|${u.drugName}`;
    if (seenUnavailable.has(k)) continue;
    seenUnavailable.add(k);
    blockers.push({ scope: 'COMPLETENESS', type: 'SAFETY_DATA_UNAVAILABLE', description: `"${u.drugName}" cannot be safety-checked: no normalised medication`, relatedNodeIds: u.nodeId ? [u.nodeId] : [] });
  }

  if (input.scope === 'ROOT') {
    const hasAction = [...input.state.values()].some((n) => ACTION_NODE_TYPES.has(n.nodeType) && n.status === NodeStatus.INCLUDED);
    if (!hasAction) {
      blockers.push({ scope: 'OUTPUT', type: 'EMPTY_PLAN', description: 'No included action nodes — care plan would be empty', relatedNodeIds: [] });
    }
  }

  const degraded = input.isDegraded || [...input.state.values()].some((n) => INCOMPLETE.includes(n.status));
  return { ready: blockers.length === 0, blockers, status: degraded ? 'DEGRADED' : 'ACTIVE' };
}
```

`PENDING_GATE` is raised for Gate and DecisionPoint nodes only. Nodes swept PENDING beneath them
are covered by their gate's blocker. Today's `validateForGeneration` raised one blocker per
PENDING node of any type; that per-descendant noise is intentionally dropped.

- [ ] **Step 7: Run the test and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-readiness.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS; typecheck clean.

**Falsify:** in `readinessOf`, change `if (input.scope === 'ROOT')` to `if (true)`. The
`CONTRIBUTION` assertion must fail. Restore it.

- [ ] **Step 8: Commit**

```bash
git -C $W add apps/pathway-service/src/services/resolution/types.ts apps/pathway-service/src/services/resolution/pipeline apps/pathway-service/src/__tests__/pipeline-readiness.test.ts
git -C $W commit -m "feat(pathway-service): eligibility/disposition layers and scoped readiness

applyDisposition keeps the traversal decision as eligibility and records
safety withholding as disposition (C2). readinessOf applies one rule set
with completeness and output scopes, blocking on tentative questions and
unnormalised medications (C3, D3, D14).

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 7: `evaluate()` and acceptance A1, A2

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/temporal/fact-store.ts` (export `factStoreFor`)
- Create: `apps/pathway-service/src/services/resolution/pipeline/evaluate.ts`
- Create: `apps/pathway-service/src/__tests__/fixtures/pipeline-env.ts`
- Test:
  - `apps/pathway-service/src/__tests__/pipeline-acceptance-a1.test.ts`
  - `apps/pathway-service/src/__tests__/pipeline-acceptance-a2.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6;
  `buildEffectivePatientContext(initial, additions)` (`effective-context.ts:34`);
  `assertEncounterAnchor(rctx, clock)` (`resolution-context.ts:750`).
- Produces:
  - `factStoreFor(effective: PatientContext, temporalCtx: EvaluationTemporalContext): FactStore`
  - `class EvaluationError extends Error { code: 'SESSION_GRAPH_CHANGED' }`
  - `evaluate(inputs: SessionInputs, env: EvaluationEnv, observations: ObservationProvider, scope: EvaluationScope): Promise<EvaluationResult>`
  - `resultHashOf(result: Omit<EvaluationResult, 'resultHash'>): string`
  - Fixtures `node`, `edge`, `makeEnv(nodes, edges, safety?)`, `makeInputs(env, patch?)`, used by Task 9.

- [ ] **Step 1: Create the fixture**

Create `apps/pathway-service/src/__tests__/fixtures/pipeline-env.ts`:

```ts
import { ConfidenceEngine } from '../../services/confidence/confidence-engine';
import { ScorerRegistry } from '../../services/confidence/scorer-registry';
import { WeightCascadeResolver } from '../../services/confidence/weight-cascade-resolver';
import { GraphEdge, GraphNode, ScoringType, SignalDefinition, ThresholdScope, WeightSource } from '../../services/confidence/types';
import { buildGraphContext } from '../../resolvers/helpers/resolution-context';
import type { ResolutionContext } from '../../resolvers/helpers/resolution-context';
import { EvaluationEnv, graphFingerprintOf } from '../../services/resolution/pipeline/load-env';
import type { SafetyReference } from '../../services/medications/safety-reference';
import type { SessionInputs } from '../../services/resolution/pipeline/types';
import { makeEvaluationTemporalContext } from '../../services/resolution/temporal/evaluation-context';

export const node = (id: string, type: string, props: Record<string, unknown> = {}): GraphNode =>
  ({ id, nodeIdentifier: id, nodeType: type, properties: { title: id, ...props } });
export const edge = (s: string, t: string, type = 'HAS_CHILD'): GraphEdge =>
  ({ id: `${s}->${t}`, edgeType: type, sourceId: s, targetId: t, properties: {} });

const SIGNAL: SignalDefinition = {
  id: '00000000-0000-4000-a000-0000000000a1', name: 'data_completeness', displayName: 'Data', description: '',
  scoringType: ScoringType.DATA_PRESENCE, scoringRules: {}, propagationConfig: { mode: 'none' },
  scope: 'SYSTEM', defaultWeight: 1, isActive: true,
};

/** Each node scores its `score` property (default 0.9). */
function registry(): ScorerRegistry {
  const r = new ScorerRegistry();
  r.register({
    scoringType: ScoringType.DATA_PRESENCE,
    declareRequiredInputs: () => [],
    score: ({ node: n }: { node: GraphNode }) => ({ score: (n.properties.score as number) ?? 0.9, missingInputs: [] }),
  } as never);
  return r;
}

export function makeEnv(nodes: GraphNode[], edges: GraphEdge[], safety: Partial<SafetyReference> = {}): EvaluationEnv {
  const resolution: ResolutionContext = {
    graphContext: buildGraphContext(nodes, edges),
    edges,
    signals: [SIGNAL],
    thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6 },
    confidenceEngine: new ConfidenceEngine(registry(), new WeightCascadeResolver()),
    codeMap: new Map(),
    temporalDefaults: {},
  };
  return {
    resolution,
    scoring: {
      adminEvidenceEntries: [],
      weightMatrix: Object.fromEntries(nodes.map((n) => [n.nodeIdentifier, { data_completeness: { weight: 1, source: WeightSource.SYSTEM_DEFAULT } }])),
      nodeWeightMap: new Map(),
      propagationOverrides: new Map(),
      thresholds: { autoResolveThreshold: 0.85, suggestThreshold: 0.6, scope: ThresholdScope.SYSTEM_DEFAULT },
    },
    safety: { normalized: new Map(), pairs: new Map(), classRules: [], allergyMappings: [], ...safety },
    graphFingerprint: graphFingerprintOf(resolution),
    envFingerprint: 'env-test',
    llmModel: 'test-model',
    unnormalized: [],
  };
}

export function makeInputs(env: EvaluationEnv, patch: Partial<SessionInputs> = {}): SessionInputs {
  return {
    pathwayId: 'pw-test',
    graphFingerprint: env.graphFingerprint,
    temporalContext: makeEvaluationTemporalContext({ evaluationAsOf: '2026-09-15T12:00:00.000Z', temporalPolicyVersion: 'v1' }),
    initialPatientContext: { patientId: 'patient-1', conditionCodes: [], medications: [], labResults: [], allergies: [] },
    additionalContext: {},
    gateAnswers: new Map(),
    providerOverrides: new Map(),
    observations: new Map(),
    revision: 0,
    ...patch,
  };
}
```

- [ ] **Step 2: Write the failing acceptance tests**

Create `apps/pathway-service/src/__tests__/pipeline-acceptance-a1.test.ts`:

```ts
import { canonicalJson } from '../services/resolution/pipeline/canonical';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { liveObservations, observationKey, replayObservations } from '../services/resolution/pipeline/observations';
import { DefaultBehavior, GateProperties, GateType, NodeStatus } from '../services/resolution/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const llm = node('gate-llm', 'Gate', {
  gate_type: GateType.LLM_TEXT_ANALYSIS, default_behavior: DefaultBehavior.SKIP, prompt: 'Urgent?',
  input_attribute: 'freeformData.narrative', confidence_threshold: 0.75,
  branches: [{ name: 'urgent', description: 'same day' }, { name: 'routine', description: 'can wait', is_safe_default: true }],
});
const env = makeEnv(
  [node('root', 'Pathway'), node('stage', 'Stage'), llm, node('step', 'Step'), node('lab', 'LabTest')],
  [edge('root', 'stage'), edge('stage', 'gate-llm'), edge('gate-llm', 'step'), edge('step', 'lab')],
);
const withNarrative = (narrative: string) =>
  makeInputs(env, { initialPatientContext: { patientId: 'p', conditionCodes: [], medications: [], labResults: [], allergies: [], freeformData: { narrative } } });
const keyFor = (narrative: string) => observationKey(llm.properties as unknown as GateProperties, 'gate-llm', narrative, 'test-model');
const output = { chosenBranch: 'urgent', confidence: 0.95, reasoning: 'r', rawResponse: {}, model: 'test-model', latencyMs: 1 };

describe('A1 — observations (C1)', () => {
  it('replay: frozen inputs, env and observations give identical results', async () => {
    const key = keyFor('crushing chest pain');
    const inputs = { ...withNarrative('crushing chest pain'), observations: new Map([[key, { key, gateId: 'gate-llm', chosenBranch: 'urgent', confidence: 0.95, reasoning: 'r', model: 'test-model', acquiredAt: 't' }]]) };

    const a = await evaluate(inputs, env, replayObservations(inputs.observations, 'test-model'), 'ROOT');
    const b = await evaluate(inputs, env, replayObservations(inputs.observations, 'test-model'), 'ROOT');

    expect(canonicalJson(b)).toBe(canonicalJson(a));
    expect(b.resultHash).toBe(a.resultHash);
    expect(a.observationsUsed).toEqual([key]);
    expect(a.resolutionState.get('gate-llm')!.status).toBe(NodeStatus.INCLUDED);
    expect(a.pendingQuestions).toEqual([]);
  });

  it('UNAVAILABLE is never a clinical false: safe default, tentative, blocks readiness', async () => {
    const r = await evaluate(withNarrative('crushing chest pain'), env, replayObservations(new Map(), 'test-model'), 'ROOT');

    expect(r.resolutionState.get('gate-llm')!.status).toBe(NodeStatus.INCLUDED);
    expect(r.resolutionState.get('gate-llm')!.status).not.toBe(NodeStatus.GATED_OUT);
    expect(r.pendingQuestions[0]).toMatchObject({ gateId: 'gate-llm', tentative: true });
    expect(r.readiness.blockers).toContainEqual(expect.objectContaining({ scope: 'COMPLETENESS', type: 'PENDING_GATE', relatedNodeIds: ['gate-llm'] }));
  });

  it('a retried attempt reuses the request observation; changed context calls again', async () => {
    const client = jest.fn().mockResolvedValue(output);
    const request = new Map();
    await evaluate(withNarrative('crushing chest pain'), env, liveObservations(new Map(), request, client, 'test-model'), 'ROOT');
    await evaluate(withNarrative('crushing chest pain'), env, liveObservations(new Map(), request, client, 'test-model'), 'ROOT');
    expect(client).toHaveBeenCalledTimes(1);

    await evaluate(withNarrative('mild cough'), env, liveObservations(new Map(), request, client, 'test-model'), 'ROOT');
    expect(client).toHaveBeenCalledTimes(2);
  });

  it('refuses a session whose graph changed', async () => {
    await expect(evaluate({ ...withNarrative('x'), graphFingerprint: 'stale' }, env, replayObservations(new Map(), 'test-model'), 'ROOT'))
      .rejects.toMatchObject({ code: 'SESSION_GRAPH_CHANGED' });
  });
});
```

Create `apps/pathway-service/src/__tests__/pipeline-acceptance-a2.test.ts`:

```ts
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { replayObservations } from '../services/resolution/pipeline/observations';
import { DefaultBehavior, GateType, NodeStatus } from '../services/resolution/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const nodes = [
  node('root', 'Pathway'), node('stage', 'Stage'), node('step', 'Step'),
  node('med-amox', 'Medication', { name: 'Amoxicillin' }),
  node('gate-dep', 'Gate', { gate_type: GateType.PRIOR_NODE_RESULT, default_behavior: DefaultBehavior.SKIP, depends_on: [{ node_id: 'step', status: 'INCLUDED' }] }),
  node('lab', 'LabTest'),
];
const edges = [edge('root', 'stage'), edge('stage', 'step'), edge('step', 'med-amox'), edge('step', 'gate-dep'), edge('gate-dep', 'lab')];
const AMOX = { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] };
const penicillinAllergy = { allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }] };
const patient = (allergic: boolean) => ({
  patientId: 'p', conditionCodes: [], medications: [], labResults: [],
  allergies: allergic ? [{ code: '91936005', system: 'SNOMED', display: 'Allergy to penicillin' }] : [],
});
const run = async (allergic: boolean, normalized = new Map([['amoxicillin||', AMOX]]), scope: 'ROOT' | 'CONTRIBUTION' = 'ROOT') => {
  const env = makeEnv(nodes, edges, { normalized, ...penicillinAllergy });
  return evaluate(makeInputs(env, { initialPatientContext: patient(allergic) }), env, replayObservations(new Map(), 'test-model'), scope);
};

describe('A2 — eligibility versus disposition (C2)', () => {
  it('a medication suppressed by allergy keeps its eligibility and both explanations', async () => {
    const control = (await run(false)).resolutionState.get('med-amox')!;
    expect(control.disposition!.status).toBe(NodeStatus.INCLUDED);

    const med = (await run(true)).resolutionState.get('med-amox')!;
    expect(med.eligibility).toEqual({ status: NodeStatus.INCLUDED, reason: undefined, decidedBy: 'traversal' });
    expect(med.disposition).toMatchObject({ status: NodeStatus.EXCLUDED, withheldBy: 'safety' });
    expect(med.status).toBe(NodeStatus.EXCLUDED);
    expect(med.excludeReason).toContain('ALLERGY');
  });

  it('a prior_node_result gate on a Step is unaffected by suppression', async () => {
    for (const allergic of [false, true]) {
      const r = await run(allergic);
      expect(r.resolutionState.get('gate-dep')!.status).toBe(NodeStatus.INCLUDED);
      expect(r.resolutionState.get('lab')!.status).toBe(NodeStatus.INCLUDED);
    }
  });

  it('an unnormalised medication blocks with SAFETY_DATA_UNAVAILABLE; normalising it clears the blocker (D14)', async () => {
    const blocked = await run(false, new Map());
    expect(blocked.readiness.blockers).toContainEqual(expect.objectContaining({ type: 'SAFETY_DATA_UNAVAILABLE', relatedNodeIds: ['med-amox'] }));
    expect((await run(false)).readiness.blockers.map((b) => b.type)).not.toContain('SAFETY_DATA_UNAVAILABLE');
  });
});

describe('scope (C3)', () => {
  const pairNodes = [node('root', 'Pathway'), node('step', 'Step'), node('w', 'Medication', { name: 'Warfarin' }), node('a', 'Medication', { name: 'Aspirin' })];
  const pairEdges = [edge('root', 'step'), edge('step', 'w'), edge('step', 'a')];
  const safety = {
    normalized: new Map([
      ['warfarin||', { ingredientRxcui: '11289', ingredientName: 'warfarin', atcClasses: ['B01AA03'] }],
      ['aspirin||', { ingredientRxcui: '1191', ingredientName: 'aspirin', atcClasses: ['B01AC06'] }],
    ]),
    pairs: new Map([['11289|1191', { severity: 'SEVERE' as const, mechanism: 'bleeding', clinicalAdvice: null, matchType: 'PAIR' as const, matchedClasses: null }]]),
  };

  it('pair safety runs at ROOT only', async () => {
    const env = makeEnv(pairNodes, pairEdges, safety);
    const root = await evaluate(makeInputs(env), env, replayObservations(new Map(), 'test-model'), 'ROOT');
    const child = await evaluate(makeInputs(env), env, replayObservations(new Map(), 'test-model'), 'CONTRIBUTION');

    expect(root.resolutionState.get('w')!.disposition!.withheldBy).toBe('safety');
    expect(root.readiness.blockers.map((b) => b.type)).toContain('EMPTY_PLAN');
    expect(child.resolutionState.get('w')!.disposition!.status).toBe(NodeStatus.INCLUDED);
    expect(child.readiness.blockers.map((b) => b.type)).not.toContain('EMPTY_PLAN');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-acceptance-a1.test.ts src/__tests__/pipeline-acceptance-a2.test.ts`
Expected: FAIL with `Cannot find module '../services/resolution/pipeline/evaluate'`.

- [ ] **Step 4: Export `factStoreFor`**

In `temporal/fact-store.ts`, add after `factStoreForInput` (line 78):

```ts
/** The store for an already-effective context under a clock — the pipeline's stage 1. */
export function factStoreFor(effective: PatientContext, temporalCtx: EvaluationTemporalContext): FactStore {
  if (!needsFactStore(temporalCtx)) return [];
  return assembleUnderClock(toSyntheticContext(effective), temporalCtx);
}
```

- [ ] **Step 5: Create `pipeline/evaluate.ts`**

```ts
import { assertEncounterAnchor } from '../../../resolvers/helpers/resolution-context';
import type { GraphNode, NodeConfidenceResult } from '../../confidence/types';
import { buildEffectivePatientContext } from '../effective-context';
import { factStoreFor } from '../temporal/fact-store';
import { TraversalEngine } from '../traversal-engine';
import { hashOf } from './canonical';
import { applyDisposition, medicationCandidates } from './disposition';
import { catchUpItemsFor, gateContextFieldsOf } from './findings';
import type { EvaluationEnv } from './load-env';
import type { ObservationProvider } from './observations';
import { readinessOf } from './readiness';
import { pairSafety, patientSafety } from './safety';
import type { EvaluationResult, EvaluationScope, SessionInputs } from './types';

export class EvaluationError extends Error {
  constructor(message: string, readonly code: 'SESSION_GRAPH_CHANGED') {
    super(message);
    this.name = 'EvaluationError';
  }
}

const unscored = (n: GraphNode): NodeConfidenceResult =>
  ({ nodeIdentifier: n.nodeIdentifier, nodeType: n.nodeType, confidence: 0, breakdown: [], propagationInfluences: [] });

/**
 * The deterministic core (spec C1, §2). Frozen inputs, env and observations
 * (`replay`) give an identical result, `resultHash` included. No I/O except
 * through `observations`.
 */
export async function evaluate(
  inputs: SessionInputs,
  env: EvaluationEnv,
  observations: ObservationProvider,
  scope: EvaluationScope,
): Promise<EvaluationResult> {
  if (env.graphFingerprint !== inputs.graphFingerprint) {
    throw new EvaluationError(`pathway ${inputs.pathwayId} graph changed since the session started`, 'SESSION_GRAPH_CHANGED');
  }
  const rctx = env.resolution;

  // 1. Context
  const patient = buildEffectivePatientContext(inputs.initialPatientContext, inputs.additionalContext);
  assertEncounterAnchor(rctx, inputs.temporalContext);
  const factStore = factStoreFor(patient, inputs.temporalContext);

  // 2. Scores — once, whole graph
  const scored = rctx.confidenceEngine.scorePathway(env.scoring, {
    pathwayId: inputs.pathwayId,
    nodes: rctx.graphContext.allNodes,
    edges: rctx.edges,
    signalDefinitions: rctx.signals,
    patientContext: patient,
  });
  const scores = new Map(scored.nodes.map((n) => [n.nodeIdentifier, n]));

  // 3. Traverse → eligibility
  const engine = new TraversalEngine(
    { computeNodeConfidence: async (n: GraphNode) => scores.get(n.nodeIdentifier) ?? unscored(n) },
    rctx.thresholds,
    inputs.temporalContext,
    rctx.temporalDefaults,
    factStore,
    rctx.codeMap,
    observations.evaluator,
  );
  const t = await engine.traverse(rctx.graphContext, patient, inputs.gateAnswers, inputs.providerOverrides);

  // 4. Findings
  const catchUpItems = catchUpItemsFor(t.resolutionState, patient, rctx.graphContext, inputs.pathwayId);
  const gateContextFields = gateContextFieldsOf(t.dependencyMap);

  // 5–6. Safety → disposition
  const candidates = medicationCandidates(t.resolutionState);
  const patientOutcome = patientSafety(env.safety, candidates, patient);
  const setOutcome = scope === 'ROOT'
    ? pairSafety(env.safety, candidates.filter((c) => !patientOutcome.suppressed.has(c.recommendationId)))
    : { findings: [], suppressed: new Set<string>() };
  const safetyFindings = [...patientOutcome.findings, ...setOutcome.findings];
  const resolutionState = applyDisposition(t.resolutionState, safetyFindings);

  // 7. Readiness
  const { ready, blockers, status } = readinessOf({
    state: resolutionState,
    pendingQuestions: t.pendingQuestions,
    redFlags: t.redFlags,
    unavailable: patientOutcome.unavailable,
    scope,
    isDegraded: t.isDegraded,
  });

  const result: Omit<EvaluationResult, 'resultHash'> = {
    scope,
    resolutionState,
    pendingQuestions: t.pendingQuestions,
    redFlags: t.redFlags,
    safetyFindings,
    safetyUnavailable: patientOutcome.unavailable,
    catchUpItems,
    gateContextFields,
    readiness: { ready, blockers },
    status,
    observationsUsed: [...observations.used].sort(),
    envFingerprint: env.envFingerprint,
  };
  return { ...result, resultHash: resultHashOf(result) };
}

const by = <T>(key: (x: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

const omit = (o: object, keys: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/** Spec §1 rule 8: what a provider reviews — no confidences, durations, reasoning text or fingerprints. */
export function resultHashOf(r: Omit<EvaluationResult, 'resultHash'>): string {
  return hashOf({
    nodes: [...r.resolutionState.values()]
      .map((n) => ({
        nodeId: n.nodeId,
        eligibility: n.eligibility?.status ?? null,
        disposition: n.disposition?.status ?? null,
        withheldBy: n.disposition?.withheldBy ?? null,
        excludeReason: n.excludeReason ?? null,
        override: n.providerOverride?.action ?? null,
      }))
      .sort(by((n) => n.nodeId)),
    pendingQuestions: [...r.pendingQuestions]
      .sort(by((q) => q.gateId))
      .map((q) => omit(q, ['tentativeReasoning', 'tentativeConfidence'])),
    redFlags: [...r.redFlags].sort(by((f) => `${f.nodeId}|${f.type}`)),
    safetyFindings: [...r.safetyFindings]
      .sort(by((f) => `${f.recommendationId}|${f.category}|${JSON.stringify(f.source)}|${f.scope}`))
      .map((f) => omit(f, ['meta'])),
    catchUpItems: [...r.catchUpItems].sort(by((c) => c.nodeId)),
    blockers: [...r.readiness.blockers].sort(by((b) => `${b.scope}|${b.type}|${b.relatedNodeIds.join(',')}`)),
  });
}
```

- [ ] **Step 6: Run the acceptance tests and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-acceptance-a1.test.ts src/__tests__/pipeline-acceptance-a2.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS; typecheck clean.

**Falsify, one change at a time, restoring each:**
1. In `evaluate`, pass `new Map()` instead of `inputs.providerOverrides`. No A1/A2 test covers
   overrides, so this is not expected to fail here; Task 9's property generator covers it.
2. In `evaluate`, set `setOutcome` to the ROOT branch unconditionally. The *scope* test must fail.
3. In `applyDisposition`, drop `eligibility` from the spread. The first A2 test must fail.

- [ ] **Step 7: Commit**

```bash
git -C $W add apps/pathway-service/src/services/resolution/temporal/fact-store.ts apps/pathway-service/src/services/resolution/pipeline/evaluate.ts apps/pathway-service/src/__tests__/fixtures/pipeline-env.ts apps/pathway-service/src/__tests__/pipeline-acceptance-a1.test.ts apps/pathway-service/src/__tests__/pipeline-acceptance-a2.test.ts
git -C $W commit -m "feat(pathway-service): deterministic evaluate() over inputs, env and observations

Composes context, one whole-graph scoring pass, traversal with overrides,
findings, scoped safety with disposition layers, and readiness, and
hashes what a provider reviews. Acceptance A1 (observations) and A2
(eligibility versus disposition) pass. No resolver calls it yet.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 8: Import rule — `depends_on` may not target Medication

**Files:**
- Modify: `apps/pathway-service/src/services/import/validator.ts:209` (call site) and `:219-254`
  (`validateGateNodes`)
- Test: `apps/pathway-service/src/__tests__/pipeline-depends-on-medication.test.ts`

**Interfaces:**
- Consumes: `validatePathwayJson(pw, options)`; `clonePathway()` (`__tests__/fixtures/reference-pathway`).
- Produces: a validation error containing `depends_on may not target Medication`.

- [ ] **Step 1: Write the failing test**

Create `apps/pathway-service/src/__tests__/pipeline-depends-on-medication.test.ts`:

```ts
import { validatePathwayJson } from '../services/import/validator';
import { clonePathway } from './fixtures/reference-pathway';

function withDependency(depends_on: unknown) {
  const pw = clonePathway();
  pw.nodes.push({ id: 'med-dep-target', type: 'Medication' as any, properties: { name: 'Labetalol', role: 'first_line' } });
  pw.edges.push({ from: 'step-1-1', to: 'med-dep-target', type: 'HAS_MEDICATION' as any });
  pw.nodes.push({ id: 'gate-dep', type: 'Gate' as any, properties: { title: 'Dep', gate_type: 'prior_node_result', default_behavior: 'skip', depends_on } });
  pw.edges.push({ from: 'step-1-1', to: 'gate-dep', type: 'HAS_GATE' as any });
  pw.edges.push({ from: 'gate-dep', to: 'step-1-2', type: 'BRANCHES_TO' as any });
  return validatePathwayJson(pw);
}

describe('depends_on may not target Medication (spec C2, D11)', () => {
  it('rejects a Medication target in bare-string form', () => {
    expect(withDependency(['med-dep-target']).errors).toContainEqual(expect.stringContaining('depends_on may not target Medication'));
  });

  it('rejects a Medication target in canonical form', () => {
    expect(withDependency([{ node_id: 'med-dep-target', status: 'INCLUDED' }]).errors)
      .toContainEqual(expect.stringContaining('depends_on may not target Medication'));
  });

  it('allows a Step target', () => {
    const r = withDependency([{ node_id: 'step-1-1', status: 'INCLUDED' }]);
    expect(r.errors).not.toContainEqual(expect.stringContaining('depends_on may not target Medication'));
    expect(r.errors).not.toContainEqual(expect.stringContaining('nonexistent node'));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-depends-on-medication.test.ts`
Expected: FAIL. The first two tests find no such error. The third fails on
`nonexistent node "[object Object]"`, because today's check stringifies object entries.

- [ ] **Step 3: Implement**

1. Line 209: `validateGateNodes(pw, nodeIds, errors, warnings, draftMode);` →
   `validateGateNodes(pw, nodeIds, nodeTypeMap, errors, warnings, draftMode);`
2. Add `nodeTypeMap: Map<string, string>,` after `nodeIds: Set<string>,` in the signature
   (line 221).
3. Replace the `depends_on` block (lines 244–254) with:

```ts
    // depends_on targets must exist, and must not be a Medication. A
    // medication's final status can be withheld after traversal (safety,
    // conflict selection), so a dependency on it cannot be evaluated
    // consistently (spec C2). Both the bare-string and the canonical
    // `{ node_id, status }` shapes are read.
    if (props.depends_on) {
      const dependsOn = (Array.isArray(props.depends_on) ? props.depends_on : [props.depends_on]) as unknown[];
      for (const dep of dependsOn) {
        const depId = typeof dep === 'string' ? dep : String((dep as { node_id?: unknown })?.node_id ?? '');
        if (!nodeIds.has(depId)) {
          errors.push(`Gate "${gate.id}": depends_on references nonexistent node "${depId}"`);
          continue;
        }
        if (nodeTypeMap.get(depId) === 'Medication') {
          errors.push(`Gate "${gate.id}": depends_on may not target Medication node "${depId}" — a medication can be withheld after traversal, so the dependency cannot be evaluated consistently`);
        }
      }
    }
```

This also makes the canonical object shape importable. If `fix/gate-depends-on-strict-shape`
merges into the base first, keep that branch's shape handling and add only the Medication check.

- [ ] **Step 4: Run the new test and the validator suite; typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-depends-on-medication.test.ts src/__tests__/validator.test.ts
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected: PASS, including `should reject Gate with nonexistent depends_on references`; typecheck
clean.

- [ ] **Step 5: Commit**

```bash
git -C $W add apps/pathway-service/src/services/import/validator.ts apps/pathway-service/src/__tests__/pipeline-depends-on-medication.test.ts
git -C $W commit -m "feat(pathway-service): reject depends_on that targets a Medication

A medication's final status can be withheld after traversal, so a gate
dependency on it cannot be evaluated consistently (C2, D11). Live graphs
hold no such dependency. Reads both depends_on shapes.

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
```

---

### Task 9: Property tests, suite, push

**Files:**
- Modify: root `package.json` (devDependency `fast-check`)
- Test: `apps/pathway-service/src/__tests__/pipeline-properties.test.ts`

**Interfaces:**
- Consumes: `evaluate`, `replayObservations`, `canonicalJson` and the fixtures from Task 7.

- [ ] **Step 1: Install fast-check at the repository root**

Jest and ts-jest are declared in the root `package.json`, and there are no npm workspaces.

```bash
npm install --save-dev fast-check@3 --prefix $W
node -e "console.log(require.resolve('fast-check', { paths: ['$W/apps/pathway-service'] }))"
```
Expected: a path under `$W/node_modules/fast-check`.

- [ ] **Step 2: Write the property test**

Create `apps/pathway-service/src/__tests__/pipeline-properties.test.ts`:

```ts
import * as fc from 'fast-check';
import { canonicalJson } from '../services/resolution/pipeline/canonical';
import { evaluate } from '../services/resolution/pipeline/evaluate';
import { replayObservations } from '../services/resolution/pipeline/observations';
import { AnswerType, DefaultBehavior, GateAnswer, GateType, NodeStatus, OverrideAction, ProviderOverride } from '../services/resolution/types';
import { edge, makeEnv, makeInputs, node } from './fixtures/pipeline-env';

const arbScenario = fc.record({
  steps: fc.array(
    fc.record({
      medScore: fc.double({ min: 0, max: 1, noNaN: true }),
      gated: fc.boolean(),
      answer: fc.constantFrom('yes', 'no', 'none'),
      override: fc.constantFrom('none', 'include', 'exclude'),
      drug: fc.constantFrom('Amoxicillin', 'Warfarin', 'Unobtainium'),
    }),
    { minLength: 1, maxLength: 6 },
  ),
  allergic: fc.boolean(),
});

type Scenario = { steps: { medScore: number; gated: boolean; answer: string; override: string; drug: string }[]; allergic: boolean };

function build(s: Scenario) {
  const nodes = [node('root', 'Pathway'), node('stage', 'Stage')];
  const edges = [edge('root', 'stage')];
  const answers: [string, GateAnswer][] = [];
  const overrides: [string, ProviderOverride][] = [];
  s.steps.forEach((st, i) => {
    const step = `step-${i}`;
    const med = `med-${i}`;
    nodes.push(node(step, 'Step'), node(med, 'Medication', { name: st.drug, score: st.medScore }));
    edges.push(edge('stage', step));
    if (st.gated) {
      const gate = `gate-${i}`;
      nodes.push(node(gate, 'Gate', { gate_type: GateType.QUESTION, default_behavior: DefaultBehavior.SKIP, answer_type: AnswerType.BOOLEAN, prompt: `q${i}` }));
      edges.push(edge(step, gate), edge(gate, med));
      if (st.answer !== 'none') answers.push([gate, { booleanValue: st.answer === 'yes' }]);
    } else {
      edges.push(edge(step, med));
    }
    if (st.override !== 'none') {
      overrides.push([med, { action: st.override === 'include' ? OverrideAction.INCLUDE : OverrideAction.EXCLUDE, originalStatus: NodeStatus.EXCLUDED, originalConfidence: st.medScore }]);
    }
  });
  const env = makeEnv(nodes, edges, {
    normalized: new Map([
      ['amoxicillin||', { ingredientRxcui: '723', ingredientName: 'amoxicillin', atcClasses: ['J01CA04'] }],
      ['warfarin||', { ingredientRxcui: '11289', ingredientName: 'warfarin', atcClasses: ['B01AA03'] }],
    ]),
    allergyMappings: [{ snomedCode: '91936005', snomedDisplay: 'Allergy to penicillin', atcClass: 'J01C' }],
  });
  const patient = {
    patientId: 'p', conditionCodes: [], medications: [], labResults: [],
    allergies: s.allergic ? [{ code: '91936005', system: 'SNOMED' }] : [],
  };
  const inputsFor = (order: 'forward' | 'reverse') => {
    const o = <T>(xs: T[]) => (order === 'forward' ? xs : [...xs].reverse());
    return makeInputs(env, { initialPatientContext: patient, gateAnswers: new Map(o(answers)), providerOverrides: new Map(o(overrides)) });
  };
  return { env, inputsFor };
}

const replay = () => replayObservations(new Map(), 'test-model');

describe('pipeline properties (spec §5.3)', () => {
  it('(c) determinism: evaluating the same inputs twice is identical', async () => {
    await fc.assert(fc.asyncProperty(arbScenario, async (s) => {
      const { env, inputsFor } = build(s);
      const a = await evaluate(inputsFor('forward'), env, replay(), 'ROOT');
      const b = await evaluate(inputsFor('forward'), env, replay(), 'ROOT');
      expect(canonicalJson(b)).toBe(canonicalJson(a));
      expect(b.resultHash).toBe(a.resultHash);
    }), { numRuns: 100 });
  });

  it('(b) order independence: input map insertion order does not change the result', async () => {
    await fc.assert(fc.asyncProperty(arbScenario, async (s) => {
      const { env, inputsFor } = build(s);
      const a = await evaluate(inputsFor('forward'), env, replay(), 'ROOT');
      const b = await evaluate(inputsFor('reverse'), env, replay(), 'ROOT');
      expect(b.resultHash).toBe(a.resultHash);
    }), { numRuns: 100 });
  });

  it('positive control: an override is actually honoured', async () => {
    const { env, inputsFor } = build({ steps: [{ medScore: 0.1, gated: false, answer: 'none', override: 'include', drug: 'Amoxicillin' }], allergic: false });
    const r = await evaluate(inputsFor('forward'), env, replay(), 'ROOT');
    expect(r.resolutionState.get('med-0')!.eligibility).toMatchObject({ status: NodeStatus.INCLUDED, decidedBy: 'override' });
  });
});
```

- [ ] **Step 3: Run it**

Run: `npm test --prefix $W/apps/pathway-service -- --runInBand src/__tests__/pipeline-properties.test.ts`
Expected: PASS. On failure, fast-check prints a shrunk counterexample. Treat it as a defect in the
pipeline, not in the generator, until proven otherwise.

**Falsify (b):** in `resultHashOf`, remove `.sort(by((n) => n.nodeId))` from `nodes`. Reversed
override pre-seeding changes the state's insertion order, so the order property must fail (it
needs at least two overrides; fast-check finds such a case). Restore it.

- [ ] **Step 4: Full suite and typecheck**

```bash
npm test --prefix $W/apps/pathway-service -- --runInBand 2>&1 | grep -E "^(FAIL|Tests:|Test Suites:)" | sort | uniq -c
$W/node_modules/.bin/tsc -p $W/apps/pathway-service/tsconfig.json --noEmit
```
Expected:
- The only `FAIL` lines are `patient-match-scorer` and `data-completeness-scorer`.
- `Tests: 9 failed`, with passed equal to the baseline plus this plan's new tests.
- Skipped equals the baseline.
- Typecheck is clean.

Record in *Baseline*:

```markdown
## Baseline

| Point | Passed | Failed | Skipped |
|---|---|---|---|
| Task 0 (base) | … | 9 | … |
| Task 9 (end) | … | 9 | … |
```

- [ ] **Step 5: Commit and push**

```bash
git -C $W add package.json package-lock.json apps/pathway-service/src/__tests__/pipeline-properties.test.ts
git -C $W commit -m "test(pathway-service): determinism and order-independence properties for evaluate

Claude-Session: https://claude.ai/code/session_01XRNkZvQrxmRLNtJHxq71kH"
git -C $W push -u origin HEAD:refs/heads/feat/evaluation-pipeline-02-pure-core
```

Open a PR from `feat/evaluation-pipeline-02-pure-core` into **`feat/evaluation-pipeline`**. If
`gh` is not authenticated, report the compare URL instead.

- [ ] **Step 6: Report and stop**

Report the baseline table, each falsification outcome, and anything fast-check found. **Do not
start plan 03.** It is written after this plan merges.

---

## Out of scope for this plan (by design)

- **Any resolver, SDL or migration change** — plan 03.
- **`commitEvaluation`, request-level observation persistence, LLM audit rows, non-blocking
  pre-warm of `env.unnormalized`** — plan 03.
- **Property (a), sequence-vs-fresh.** It needs input accumulation, which arrives with
  `commitEvaluation` in plan 03.
- **`composeRun`, conflict selection, parent-owned facts, and A3/A4** — plan 04.
- **Deleting the incremental engine and dead code** — plan 03.
