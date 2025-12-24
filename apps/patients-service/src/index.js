"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const graphql_tag_1 = __importDefault(require("graphql-tag"));
const subgraph_1 = require("@apollo/subgraph");
const server_1 = require("@apollo/server");
const standalone_1 = require("@apollo/server/standalone");
const resolvers_1 = __importDefault(require("@patients/resolvers"));
const port = "4002";
const subgraphName = "patients";
async function main() {
    let typeDefs = (0, graphql_tag_1.default)((0, fs_1.readFileSync)("schema.graphql", {
        encoding: "utf-8",
    }));
    const server = new server_1.ApolloServer({
        schema: (0, subgraph_1.buildSubgraphSchema)({ typeDefs, resolvers: resolvers_1.default }),
    });
    const { url } = await (0, standalone_1.startStandaloneServer)(server, {
        listen: { port: Number.parseInt(port) },
    });
    console.log(`🚀  Subgraph ${subgraphName} ready at ${url}`);
}
main();
//# sourceMappingURL=index.js.map