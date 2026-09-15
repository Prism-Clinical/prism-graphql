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
    await client.query('ROLLBACK').catch((): void => undefined);
    throw err;
  } finally {
    client.release();
  }
}
