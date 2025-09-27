import { Query } from "@patients/resolvers/Query";
import { Mutation } from "@patients/resolvers/Mutation";

const resolvers = {
  ...Query,
  ...Mutation,
};

export default resolvers;