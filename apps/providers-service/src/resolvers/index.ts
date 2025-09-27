import { Query } from "@providers/resolvers/Query";
import { Mutation } from "@providers/resolvers/Mutation";

const resolvers = {
  ...Query,
  ...Mutation,
};

export default resolvers;