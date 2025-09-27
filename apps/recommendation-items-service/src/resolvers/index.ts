import { Query } from "@recommendation-items/resolvers/Query";
import { Mutation } from "@recommendation-items/resolvers/Mutation";

const resolvers = {
  ...Query,
  ...Mutation,
};

export default resolvers;