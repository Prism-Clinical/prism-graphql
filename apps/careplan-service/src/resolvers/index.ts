import { GraphQLScalarType, Kind, ObjectValueNode, ValueNode, ListValueNode } from "graphql";
import { Query } from "./Query";
import { Mutation } from "./Mutation";
import {
  documentQueryResolvers,
  documentMutationResolvers,
} from "./DocumentResolvers";

// JSON scalar implementation for flexible input values
function parseLiteralValue(ast: ValueNode): any {
  switch (ast.kind) {
    case Kind.STRING:
      return ast.value;
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
      return parseInt(ast.value, 10);
    case Kind.FLOAT:
      return parseFloat(ast.value);
    case Kind.OBJECT:
      return (ast as ObjectValueNode).fields.reduce((acc: Record<string, any>, field) => {
        acc[field.name.value] = parseLiteralValue(field.value);
        return acc;
      }, {});
    case Kind.LIST:
      return (ast as ListValueNode).values.map(parseLiteralValue);
    case Kind.NULL:
      return null;
    default:
      return null;
  }
}

const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'JSON scalar type for arbitrary JSON values',
  serialize(value) { return value; },
  parseValue(value) { return value; },
  parseLiteral(ast) { return parseLiteralValue(ast); },
});

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
  JSON: JSONScalar,
  ...Query,
  ...Mutation,
  Query: {
    ...(Query as any).Query,
    ...documentQueryResolvers,
    // Pipeline queries
    pipelineRequest,
    carePlanReview,
    pipelineHealth,
    pendingRecommendationsForVisit,
  },
  Mutation: {
    ...(Mutation as any).Mutation,
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
