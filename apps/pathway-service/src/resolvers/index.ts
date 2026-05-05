import { Query } from "./Query";
import { Mutation } from "./Mutation";
import { multiPathwayResolutionTypeResolvers } from "./mutations/multi-pathway-resolution";

const resolvers = {
  ...Query,
  ...Mutation,
  ...multiPathwayResolutionTypeResolvers,
};

export default resolvers;
