import { Query } from "./Query";
import { Mutation } from "./Mutation";
import {
  documentQueryResolvers,
  documentMutationResolvers,
} from "./DocumentResolvers";

const resolvers = {
  ...Query,
  ...Mutation,
  Query: {
    ...documentQueryResolvers,
  },
  Mutation: {
    ...documentMutationResolvers,
  },
};

export default resolvers;
