import { importMutations } from './mutations/import';
import { confidenceMutations } from './mutations/confidence';
import { resolutionMutations } from './mutations/resolution';
import { multiPathwayResolutionMutations } from './mutations/multi-pathway-resolution';
import { medicationAdminMutations } from './mutations/medication-admin';

// Re-export interfaces for external consumers
export type {
  CreateSignalInput,
  SetSignalWeightInput,
  SetThresholdsInput,
  SetNodeWeightInput,
  UpdateSignalInput,
} from './mutations/confidence';

export type {
  GateAnswerInput,
  AdditionalContextInput,
} from './mutations/resolution';

// Re-export helpers for use by other modules
export {
  buildGraphContext,
  fetchGraphFromAGE,
  buildResolutionContext,
  makeTraversalAdapter,
  makeRetraversalAdapter,
} from './helpers/resolution-context';
export type { ResolutionContext } from './helpers/resolution-context';

export const Mutation = {
  Mutation: {
    ...importMutations,
    ...confidenceMutations,
    ...resolutionMutations,
    ...multiPathwayResolutionMutations,
    ...medicationAdminMutations,
  },
};
