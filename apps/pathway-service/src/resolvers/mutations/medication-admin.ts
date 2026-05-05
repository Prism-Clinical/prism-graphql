/**
 * Phase 4 commit 6: GraphQL surface for the unnormalized-medication admin queue.
 */

import { GraphQLError } from 'graphql';
import { DataSourceContext } from '../../types';
import {
  listUnnormalizedMedications,
  manuallyResolveMedicationNormalization,
} from '../../services/medications/admin-queue';

export const medicationAdminQueries = {
  async unnormalizedMedications(
    _: unknown,
    _args: unknown,
    context: DataSourceContext,
  ) {
    const rows = await listUnnormalizedMedications(context.pool);
    return rows.map((r) => ({
      inputText: r.inputText,
      inputSystem: r.inputSystem,
      inputCode: r.inputCode,
      attemptedAt: r.attemptedAt.toISOString(),
    }));
  },
};

export const medicationAdminMutations = {
  async manuallyResolveMedicationNormalization(
    _: unknown,
    args: { inputText: string; inputSystem?: string; inputCode?: string; rxcui: string },
    context: DataSourceContext,
  ) {
    try {
      return await manuallyResolveMedicationNormalization(context.pool, args);
    } catch (err) {
      throw new GraphQLError(
        err instanceof Error ? err.message : 'Manual normalization failed',
        { extensions: { code: 'BAD_USER_INPUT' } },
      );
    }
  },
};
