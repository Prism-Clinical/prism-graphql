import { GraphQLError } from 'graphql';
import { DataSourceContext } from '../types';
import { hydrateSignalDefinition } from './Query';

export const Mutation = {
  Mutation: {
    async createSignalDefinition(
      _parent: unknown,
      args: { input: any },
      context: DataSourceContext
    ) {
      const { pool } = context;
      const { input } = args;

      if (input.scope === 'INSTITUTION' && !input.institutionId) {
        throw new GraphQLError('institutionId is required for INSTITUTION scope', {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      let scoringRules = input.scoringRules;
      if (input.propagationConfig) {
        scoringRules = { ...scoringRules, propagation: input.propagationConfig };
      }

      const result = await pool.query(
        `INSERT INTO confidence_signal_definitions
         (name, display_name, description, scoring_type, scoring_rules, scope, institution_id, default_weight)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, display_name, description, scoring_type, scoring_rules, scope, institution_id, default_weight, is_active`,
        [input.name, input.displayName, input.description || '', input.scoringType,
         JSON.stringify(scoringRules), input.scope, input.institutionId || null, input.defaultWeight]
      );

      return hydrateSignalDefinition(result.rows[0]);
    },

    async deleteSignalDefinition(_parent: unknown, args: { id: string }, context: DataSourceContext) {
      const result = await context.pool.query(
        `DELETE FROM confidence_signal_definitions WHERE id = $1`, [args.id]
      );
      if (result.rowCount === 0) {
        throw new GraphQLError('Signal definition not found', { extensions: { code: 'NOT_FOUND' } });
      }
      return true;
    },

    async setSignalWeight(_parent: unknown, args: { input: any }, context: DataSourceContext) {
      const { pool } = context;
      const { input } = args;

      const result = await pool.query(
        `INSERT INTO confidence_signal_weights
         (signal_definition_id, weight, scope, pathway_id, node_identifier, node_type, institution_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ON CONSTRAINT confidence_signal_weights_unique
         DO UPDATE SET weight = $2
         RETURNING id, signal_definition_id, weight, scope, pathway_id, node_identifier, node_type, institution_id`,
        [input.signalDefinitionId, input.weight, input.scope, input.pathwayId || null,
         input.nodeIdentifier || null, input.nodeType || null, input.institutionId || null]
      );

      const row = result.rows[0];
      return {
        id: row.id, signalDefinitionId: row.signal_definition_id,
        weight: parseFloat(row.weight), scope: row.scope,
        pathwayId: row.pathway_id, nodeIdentifier: row.node_identifier,
        nodeType: row.node_type, institutionId: row.institution_id,
      };
    },

    async removeSignalWeight(_parent: unknown, args: { id: string }, context: DataSourceContext) {
      const result = await context.pool.query(`DELETE FROM confidence_signal_weights WHERE id = $1`, [args.id]);
      if (result.rowCount === 0) throw new GraphQLError('Signal weight not found', { extensions: { code: 'NOT_FOUND' } });
      return true;
    },

    async setResolutionThresholds(_parent: unknown, args: { input: any }, context: DataSourceContext) {
      const { pool } = context;
      const { input } = args;

      const result = await pool.query(
        `INSERT INTO confidence_resolution_thresholds
         (auto_resolve_threshold, suggest_threshold, scope, pathway_id, node_identifier, institution_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ON CONSTRAINT confidence_resolution_thresholds_unique
         DO UPDATE SET auto_resolve_threshold = $1, suggest_threshold = $2
         RETURNING id, auto_resolve_threshold, suggest_threshold, scope, pathway_id, node_identifier, institution_id`,
        [input.autoResolveThreshold, input.suggestThreshold, input.scope,
         input.pathwayId || null, input.nodeIdentifier || null, input.institutionId || null]
      );

      const row = result.rows[0];
      return {
        id: row.id, autoResolveThreshold: parseFloat(row.auto_resolve_threshold),
        suggestThreshold: parseFloat(row.suggest_threshold), scope: row.scope,
        pathwayId: row.pathway_id, nodeIdentifier: row.node_identifier, institutionId: row.institution_id,
      };
    },

    async removeResolutionThresholds(_parent: unknown, args: { id: string }, context: DataSourceContext) {
      const result = await context.pool.query(`DELETE FROM confidence_resolution_thresholds WHERE id = $1`, [args.id]);
      if (result.rowCount === 0) throw new GraphQLError('Resolution thresholds not found', { extensions: { code: 'NOT_FOUND' } });
      return true;
    },

    async setNodeWeight(_parent: unknown, args: { input: any }, context: DataSourceContext) {
      const { pool } = context;
      const { input } = args;

      const result = await pool.query(
        `INSERT INTO confidence_node_weights
         (pathway_id, node_identifier, node_type, institution_id, weight_override, propagation_overrides)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ON CONSTRAINT confidence_node_weights_unique
         DO UPDATE SET weight_override = $5, propagation_overrides = $6
         RETURNING id, pathway_id, node_identifier, node_type, default_weight, institution_id, weight_override, propagation_overrides`,
        [input.pathwayId, input.nodeIdentifier, input.nodeType,
         input.institutionId || null, input.weightOverride ?? null, JSON.stringify(input.propagationOverrides ?? {})]
      );

      const row = result.rows[0];
      return {
        id: row.id, pathwayId: row.pathway_id, nodeIdentifier: row.node_identifier,
        nodeType: row.node_type, defaultWeight: parseFloat(row.default_weight),
        institutionId: row.institution_id,
        weightOverride: row.weight_override ? parseFloat(row.weight_override) : null,
        propagationOverrides: row.propagation_overrides,
      };
    },

    async removeNodeWeight(_parent: unknown, args: { id: string }, context: DataSourceContext) {
      const result = await context.pool.query(`DELETE FROM confidence_node_weights WHERE id = $1`, [args.id]);
      if (result.rowCount === 0) throw new GraphQLError('Node weight not found', { extensions: { code: 'NOT_FOUND' } });
      return true;
    },

    async updateSignalDefinition(_parent: unknown, args: { id: string; input: any }, context: DataSourceContext) {
      const { pool } = context;
      const { id, input } = args;

      const setClauses: string[] = [];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (input.displayName !== undefined) { setClauses.push(`display_name = $${paramIdx++}`); params.push(input.displayName); }
      if (input.description !== undefined) { setClauses.push(`description = $${paramIdx++}`); params.push(input.description); }
      if (input.scoringRules !== undefined) {
        let rules = input.scoringRules;
        if (input.propagationConfig) rules = { ...rules, propagation: input.propagationConfig };
        setClauses.push(`scoring_rules = $${paramIdx++}`); params.push(JSON.stringify(rules));
      } else if (input.propagationConfig) {
        setClauses.push(`scoring_rules = scoring_rules || $${paramIdx++}::jsonb`);
        params.push(JSON.stringify({ propagation: input.propagationConfig }));
      }
      if (input.defaultWeight !== undefined) { setClauses.push(`default_weight = $${paramIdx++}`); params.push(input.defaultWeight); }
      if (input.isActive !== undefined) { setClauses.push(`is_active = $${paramIdx++}`); params.push(input.isActive); }

      if (setClauses.length === 0) throw new GraphQLError('No fields to update', { extensions: { code: 'BAD_USER_INPUT' } });

      params.push(id);
      const result = await pool.query(
        `UPDATE confidence_signal_definitions SET ${setClauses.join(', ')} WHERE id = $${paramIdx}
         RETURNING id, name, display_name, description, scoring_type, scoring_rules, scope, institution_id, default_weight, is_active`,
        params
      );

      if (!result.rows[0]) throw new GraphQLError('Signal definition not found', { extensions: { code: 'NOT_FOUND' } });
      return hydrateSignalDefinition(result.rows[0]);
    },
  },
};
