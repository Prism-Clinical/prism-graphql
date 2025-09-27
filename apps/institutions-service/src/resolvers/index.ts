import { Query } from "@institutions/resolvers/Query";
import { Mutation } from "@institutions/resolvers/Mutation";

const resolvers = {
  ...Query,
  ...Mutation,
};

export default resolvers;