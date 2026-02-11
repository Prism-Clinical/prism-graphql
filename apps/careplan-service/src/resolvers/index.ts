import { Query } from "./Query";
import { Mutation } from "./Mutation";
import {
  documentQueryResolvers,
  documentMutationResolvers,
} from "./DocumentResolvers";

// Re-export types that are used in resolvers
export type {
  DataSourceContext,
  DocumentValidationReport,
  ExportDocumentResult,
  ImportDocumentInput,
  ImportDocumentResult,
} from "./DocumentResolvers";
export type { ProgressMessage, SubscriptionContext } from "./subscriptions/generation-progress";
export type { ResolverContext } from "./Visit";

// Pipeline resolvers
import {
  generateCarePlanFromVisit,
  acceptCarePlanDraft,
  rejectCarePlanDraft,
  regenerateCarePlan,
} from "./mutations/generate-care-plan";
import { importCarePlanFromPdfFile } from "./mutations/import-pdf";
import {
  pipelineRequest,
  carePlanReview,
  pipelineHealth,
  pendingRecommendationsForVisit,
} from "./queries/pipeline-queries";
import { carePlanGenerationProgressSubscription } from "./subscriptions/generation-progress";
import { VisitResolver } from "./Visit";

const resolvers = {
  ...Query,
  ...Mutation,
  Query: {
    ...documentQueryResolvers,
    // Pipeline queries
    pipelineRequest,
    carePlanReview,
    pipelineHealth,
    pendingRecommendationsForVisit,
  },
  Mutation: {
    ...documentMutationResolvers,
    // Pipeline mutations
    generateCarePlanFromVisit,
    importCarePlanFromPdfFile,
    acceptCarePlanDraft,
    rejectCarePlanDraft,
    regenerateCarePlan,
  },
  Subscription: {
    carePlanGenerationProgress: carePlanGenerationProgressSubscription,
  },
  // Federation reference resolvers
  Visit: VisitResolver,
};

export default resolvers;
