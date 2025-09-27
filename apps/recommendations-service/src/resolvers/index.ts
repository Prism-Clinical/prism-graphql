import { Query } from "@recommendations/resolvers/Query";
import { Mutation } from "@recommendations/resolvers/Mutation";

const resolvers = {
  ...Query,
  ...Mutation,
};

export default resolvers;