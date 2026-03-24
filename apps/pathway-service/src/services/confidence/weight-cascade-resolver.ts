import { Pool } from 'pg';
import {
  SignalDefinition,
  ResolvedWeight,
  WeightSource,
  WeightMatrix,
  NodeIdentifier,
  ResolvedThresholds,
  ThresholdScope,
} from './types';

const WEIGHT_SCOPE_PRIORITY: Record<string, { source: WeightSource; priority: number }> = {
  NODE: { source: WeightSource.NODE_OVERRIDE, priority: 1 },
  PATHWAY: { source: WeightSource.PATHWAY_OVERRIDE, priority: 2 },
  INSTITUTION_GLOBAL: { source: WeightSource.INSTITUTION_GLOBAL, priority: 3 },
  ORGANIZATION_GLOBAL: { source: WeightSource.ORGANIZATION_GLOBAL, priority: 4 },
};

const THRESHOLD_SCOPE_PRIORITY: Record<string, number> = {
  NODE: 1,
  PATHWAY: 2,
  INSTITUTION: 3,
  ORGANIZATION: 4,
  SYSTEM_DEFAULT: 5,
};

export class WeightCascadeResolver {
  async resolveAllWeights(params: {
    pool: Pool;
    pathwayId: string;
    signalDefinitions: SignalDefinition[];
    nodeIdentifiers: NodeIdentifier[];
    institutionId?: string;
    organizationId?: string;
  }): Promise<WeightMatrix> {
    const { pool, pathwayId, signalDefinitions, nodeIdentifiers, institutionId, organizationId } = params;

    const queryParams: unknown[] = [pathwayId];
    let whereClause = `(pathway_id = $1 OR pathway_id IS NULL)`;

    if (institutionId) {
      queryParams.push(institutionId);
      whereClause += ` AND (institution_id = $${queryParams.length} OR institution_id IS NULL)`;
    }

    if (organizationId) {
      queryParams.push(organizationId);
      whereClause += ` AND (organization_id = $${queryParams.length} OR organization_id IS NULL)`;
    }

    const result = await pool.query(
      `SELECT signal_definition_id, node_identifier, weight, scope
       FROM confidence_signal_weights
       WHERE (${whereClause})
       ORDER BY scope ASC`,
      queryParams
    );

    const overrides = new Map<string, Map<string, { weight: number; nodeIdentifier: string | null }>>();
    for (const row of result.rows) {
      const signalId = row.signal_definition_id;
      if (!overrides.has(signalId)) {
        overrides.set(signalId, new Map());
      }
      const key = row.node_identifier ? `${row.scope}:${row.node_identifier}` : row.scope;
      overrides.get(signalId)!.set(key, {
        weight: parseFloat(row.weight),
        nodeIdentifier: row.node_identifier,
      });
    }

    const matrix: WeightMatrix = {};

    for (const node of nodeIdentifiers) {
      matrix[node.nodeIdentifier] = {};

      for (const signal of signalDefinitions) {
        const resolved = this.resolveWeight(signal, node.nodeIdentifier, overrides.get(signal.id));
        matrix[node.nodeIdentifier][signal.name] = resolved;
      }
    }

    return matrix;
  }

  async resolveThresholds(params: {
    pool: Pool;
    pathwayId: string;
    nodeIdentifier?: string;
    institutionId?: string;
    organizationId?: string;
  }): Promise<ResolvedThresholds> {
    const { pool, pathwayId, nodeIdentifier, institutionId, organizationId } = params;

    const queryParams: unknown[] = [pathwayId];
    let query = `
      SELECT auto_resolve_threshold, suggest_threshold, scope
      FROM confidence_resolution_thresholds
      WHERE (pathway_id = $1 OR pathway_id IS NULL)
    `;

    if (nodeIdentifier) {
      queryParams.push(nodeIdentifier);
      query += ` AND (node_identifier = $${queryParams.length} OR node_identifier IS NULL)`;
    } else {
      query += ` AND node_identifier IS NULL`;
    }

    if (institutionId) {
      queryParams.push(institutionId);
      query += ` AND (institution_id = $${queryParams.length} OR institution_id IS NULL)`;
    }

    if (organizationId) {
      queryParams.push(organizationId);
      query += ` AND (organization_id = $${queryParams.length} OR organization_id IS NULL)`;
    }

    query += ` ORDER BY scope ASC`;

    const result = await pool.query(query, queryParams);

    if (result.rows.length === 0) {
      return {
        autoResolveThreshold: 0.85,
        suggestThreshold: 0.60,
        scope: ThresholdScope.SYSTEM_DEFAULT,
      };
    }

    let best = result.rows[0];
    let bestPriority = THRESHOLD_SCOPE_PRIORITY[best.scope] ?? 99;

    for (const row of result.rows) {
      const priority = THRESHOLD_SCOPE_PRIORITY[row.scope] ?? 99;
      if (priority < bestPriority) {
        best = row;
        bestPriority = priority;
      }
    }

    return {
      autoResolveThreshold: parseFloat(best.auto_resolve_threshold),
      suggestThreshold: parseFloat(best.suggest_threshold),
      scope: best.scope as ThresholdScope,
    };
  }

  private resolveWeight(
    signal: SignalDefinition,
    nodeIdentifier: string,
    overridesForSignal?: Map<string, { weight: number; nodeIdentifier: string | null }>
  ): ResolvedWeight {
    if (!overridesForSignal) {
      return { weight: signal.defaultWeight, source: WeightSource.SYSTEM_DEFAULT };
    }

    const nodeKey = `NODE:${nodeIdentifier}`;
    if (overridesForSignal.has(nodeKey)) {
      return { weight: overridesForSignal.get(nodeKey)!.weight, source: WeightSource.NODE_OVERRIDE };
    }

    if (overridesForSignal.has('PATHWAY')) {
      return { weight: overridesForSignal.get('PATHWAY')!.weight, source: WeightSource.PATHWAY_OVERRIDE };
    }

    if (overridesForSignal.has('INSTITUTION_GLOBAL')) {
      return { weight: overridesForSignal.get('INSTITUTION_GLOBAL')!.weight, source: WeightSource.INSTITUTION_GLOBAL };
    }

    if (overridesForSignal.has('ORGANIZATION_GLOBAL')) {
      return { weight: overridesForSignal.get('ORGANIZATION_GLOBAL')!.weight, source: WeightSource.ORGANIZATION_GLOBAL };
    }

    return { weight: signal.defaultWeight, source: WeightSource.SYSTEM_DEFAULT };
  }
}
