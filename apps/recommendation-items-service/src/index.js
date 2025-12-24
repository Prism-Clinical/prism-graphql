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
const pg_1 = require("pg");
const ioredis_1 = __importDefault(require("ioredis"));
const resolvers_1 = __importDefault(require("@recommendation-items/resolvers"));
const database_1 = require("@recommendation-items/services/database");
const port = "4004";
const subgraphName = "recommendation-items";
async function main() {
    const pool = new pg_1.Pool({
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'prism_db',
        password: process.env.DB_PASSWORD || 'postgres',
        port: parseInt(process.env.DB_PORT || '5432'),
    });
    const redis = new ioredis_1.default({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
    });
    (0, database_1.initializeDatabase)(pool, redis);
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
main().catch(console.error);
//# sourceMappingURL=index.js.map