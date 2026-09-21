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
  /**
   * Medications with no normalised row — WHOLE inputs (text, system, code),
   * one per cache key, for the non-blocking pre-warm. The cache is keyed on
   * all three; a text alone would pre-warm a row evaluation never reads.
   */
  unnormalized: MedicationInput[];
}

export interface CandidateUniverse {
  patient: PatientContext;
  /** Provider write-ins (CUSTOM_OVERRIDE) recorded in conflict_resolutions. */
  writeIns?: string[];
}

/** A contributing pathway's identity, for the merged plan's provenance. */
export interface PathwayMeta {
  logicalId: string;
  title: string;
  version: string;
}

/** Everything a run's evaluation reads, from ONE snapshot (C4, D13). */
export interface RunEnv {
  /** By pathway id. Every child's `safety` is `safety` below. */
  children: Map<string, EvaluationEnv>;
  meta: Map<string, PathwayMeta>;
  safety: SafetyReference;
  envFingerprint: string;
  unnormalized: MedicationInput[];
}

/** The drug name safety reads for a Medication node (`medicationCandidates` names candidates the same way). */
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

/** One REPEATABLE READ snapshot on one client, closed before evaluation begins (C4). */
async function inSnapshot<T>(pool: Pool, read: (db: Pool) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const out = await read(client as unknown as Pool);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch((): void => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function readPathway(db: Pool, pathwayId: string): Promise<{ resolution: ResolutionContext; scoring: ScoringConfig }> {
  const resolution = await buildResolutionContext(db, pathwayId);
  const scoring = await resolution.confidenceEngine.loadScoringConfig({
    pool: db,
    pathwayId,
    nodes: resolution.graphContext.allNodes,
    signalDefinitions: resolution.signals,
  });
  return { resolution, scoring };
}

/** The candidate universe (C1): every Medication node, the patient's medications, every write-in. */
function candidateMedications(graphs: ResolutionContext[], universe: CandidateUniverse): MedicationInput[] {
  return [
    ...graphs.flatMap((r) => r.graphContext.allNodes.filter((n) => n.nodeType === 'Medication').map((n) => ({ text: medicationName(n) }))),
    ...universe.patient.medications.map((m) => ({ text: m.display ?? m.code, system: m.system, code: m.code })),
    ...(universe.writeIns ?? []).map((text) => ({ text })),
  ];
}

const allergyCodesOf = (universe: CandidateUniverse): string[] =>
  universe.patient.allergies.filter((a) => a.system === 'SNOMED').map((a) => a.code);

const unnormalizedOf = (medications: MedicationInput[], safety: SafetyReference): MedicationInput[] => [
  ...new Map(
    medications.filter((m) => !safety.normalized.has(normalizedKey(m))).map((m) => [normalizedKey(m), m]),
  ).values(),
];

function envOf(resolution: ResolutionContext, scoring: ScoringConfig, safety: SafetyReference, unnormalized: MedicationInput[]): EvaluationEnv {
  const graphFingerprint = graphFingerprintOf(resolution);
  const llmModel = loadLLMGateConfig()?.model ?? null;
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
}

export async function loadEvaluationEnv(pool: Pool, pathwayId: string, universe: CandidateUniverse): Promise<EvaluationEnv> {
  const read = await inSnapshot(pool, async (db) => {
    const { resolution, scoring } = await readPathway(db, pathwayId);
    const medications = candidateMedications([resolution], universe);
    const safety = await loadSafetyReference(db, { medications, allergySnomedCodes: allergyCodesOf(universe) });
    return { resolution, scoring, medications, safety };
  });
  return envOf(read.resolution, read.scoring, read.safety, unnormalizedOf(read.medications, read.safety));
}

/**
 * A run's environment: every child's graph, the pathways' metadata and ONE
 * safety reference over the whole candidate universe, in one snapshot. No
 * child is ever composed with a result from a different snapshot (D13).
 */
export async function loadRunEnv(pool: Pool, pathwayIds: string[], universe: CandidateUniverse): Promise<RunEnv> {
  const read = await inSnapshot(pool, async (db) => {
    const graphs = new Map<string, { resolution: ResolutionContext; scoring: ScoringConfig }>();
    for (const id of pathwayIds) graphs.set(id, await readPathway(db, id));
    const metaRows = pathwayIds.length === 0
      ? []
      : (await db.query('SELECT id, logical_id, title, version FROM pathway_graph_index WHERE id = ANY($1::uuid[])', [pathwayIds])).rows;
    const medications = candidateMedications([...graphs.values()].map((g) => g.resolution), universe);
    const safety = await loadSafetyReference(db, { medications, allergySnomedCodes: allergyCodesOf(universe) });
    return { graphs, metaRows, medications, safety };
  });
  const children = new Map([...read.graphs].map(([id, g]) => [id, envOf(g.resolution, g.scoring, read.safety, [])]));
  const meta = new Map<string, PathwayMeta>(
    read.metaRows.map((r: { id: string; logical_id: string; title: string; version: string }) =>
      [r.id, { logicalId: r.logical_id, title: r.title, version: r.version }]),
  );
  return { ...runEnvOf(children, meta, read.safety), unnormalized: unnormalizedOf(read.medications, read.safety) };
}

/**
 * Assemble a run's environment from its children's. Without `safety`, the
 * children's references are merged — test fixtures build one per pathway.
 * The run fingerprint is the sorted (pathway, child fingerprint) pairs; each
 * child's already covers the shared configuration, the shared safety data and
 * its graph (P4-14).
 */
export function runEnvOf(children: Map<string, EvaluationEnv>, meta: Map<string, PathwayMeta>, safety?: SafetyReference): RunEnv {
  const shared = safety ?? mergeSafety([...children.values()].map((e) => e.safety));
  const pointed = new Map([...children].map(([id, e]) => [id, { ...e, safety: shared }] as [string, EvaluationEnv]));
  const envFingerprint = hashOf(
    [...pointed].map(([id, e]) => [id, e.envFingerprint]).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)),
  );
  return { children: pointed, meta, safety: shared, envFingerprint, unnormalized: [] };
}

function mergeSafety(parts: SafetyReference[]): SafetyReference {
  return {
    normalized: new Map(parts.flatMap((p) => [...p.normalized])),
    pairs: new Map(parts.flatMap((p) => [...p.pairs])),
    classRules: parts.flatMap((p) => p.classRules),
    allergyMappings: parts.flatMap((p) => p.allergyMappings),
  };
}
