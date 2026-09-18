import type { Pool } from 'pg';
import { buildResolutionContext } from '../../resolvers/helpers/resolution-context';
import { medicationName } from '../resolution/pipeline/load-env';
import { prewarmMedications } from './normalizer';

/** Every Medication node name in a pathway, named exactly as evaluation's candidate universe names them. */
export async function pathwayMedicationNames(pool: Pool, pathwayId: string): Promise<string[]> {
  const { graphContext } = await buildResolutionContext(pool, pathwayId);
  const names = graphContext.allNodes.filter((n) => n.nodeType === 'Medication').map((n) => medicationName(n));
  return [...new Set(names)].sort();
}

/**
 * Normalise a pathway's medications through RxNav (D14). A no-match is cached
 * as a NULL row for the admin queue; a network error is left for the next try.
 */
export async function prewarmPathwayMedications(
  pool: Pool,
  pathwayId: string,
): Promise<{ total: number; succeeded: number; failed: number }> {
  const names = await pathwayMedicationNames(pool, pathwayId);
  const { succeeded, failed } = await prewarmMedications(pool, names.map((text) => ({ text })));
  return { total: names.length, succeeded, failed };
}

/** Best effort: import and activation never fail, or wait, because RxNav is slow or down (spec §4, Deployment). */
export function prewarmPathwayInBackground(pool: Pool, pathwayId: string, trigger: 'import' | 'activate'): void {
  void prewarmPathwayMedications(pool, pathwayId)
    .then((r) => console.info(`[prewarm] ${trigger} ${pathwayId}: ${r.succeeded}/${r.total} normalised, ${r.failed} not`))
    .catch((err) => console.warn(`[prewarm] ${trigger} ${pathwayId} failed:`, err instanceof Error ? err.message : err));
}
