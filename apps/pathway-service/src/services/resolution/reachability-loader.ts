import { Pool } from 'pg';
import { fetchGraphFromAGE } from '../../resolvers/helpers/resolution-context';
import { PatientContext } from '../confidence/types';
import { ReachabilityScore, scoreReachability } from './reachability';

const EMPTY_SCORE: ReachabilityScore = {
  totalGates: 0,
  alwaysEvaluableGates: 0,
  dataDependentGates: 0,
  dataAvailableGates: 0,
  questionGates: 0,
  indeterminateGates: 0,
  autoResolvableScore: null,
  gateExplanations: [],
};

/**
 * Compute decision-point reachability for a pathway against a patient's
 * current snapshot context. Loads the pathway's gates from AGE and scores
 * each one for data availability.
 *
 * Returns an empty score (totalGates: 0) when the pathway has no AGE node ID
 * (e.g., legacy pathways) or when the pathway graph cannot be loaded.
 */
export async function computePathwayReachability(
  pool: Pool,
  pathwayRelationalId: string,
  patient: PatientContext,
): Promise<ReachabilityScore> {
  const result = await pool.query(
    `SELECT age_node_id FROM pathway_graph_index WHERE id = $1`,
    [pathwayRelationalId],
  );
  const ageNodeId: string | null = result.rows[0]?.age_node_id ?? null;
  if (!ageNodeId) {
    return EMPTY_SCORE;
  }

  const { nodes } = await fetchGraphFromAGE(pool, ageNodeId);
  const gateNodes = nodes.filter((n) => n.nodeType === 'Gate');
  return scoreReachability(gateNodes, patient);
}
