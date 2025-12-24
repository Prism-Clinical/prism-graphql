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
const ioredis_1 = require("ioredis");
const resolvers_1 = __importDefault(require("@providers/resolvers"));
const database_1 = require("@providers/services/database");
const port = "4003";
const subgraphName = "providers";
async function main() {
    const pool = new pg_1.Pool({
        host: process.env.POSTGRES_HOST || 'localhost',
        port: parseInt(process.env.POSTGRES_PORT || '5432'),
        database: process.env.POSTGRES_DB || 'prism',
        user: process.env.POSTGRES_USER || 'prism',
        password: process.env.POSTGRES_PASSWORD || 'prism123',
        max: 10,
        idleTimeoutMillis: 30000,
    });
    const redis = new ioredis_1.Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        retryDelayOnFailover: 100,
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