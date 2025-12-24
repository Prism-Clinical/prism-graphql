"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Query_1 = require("@providers/resolvers/Query");
const Mutation_1 = require("@providers/resolvers/Mutation");
const resolvers = {
    ...Query_1.Query,
    ...Mutation_1.Mutation,
};
exports.default = resolvers;
//# sourceMappingURL=index.js.map