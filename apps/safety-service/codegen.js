"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config = {
    schema: "./*.graphql",
    generates: {
        "./src/__generated__/resolvers-types.ts": {
            config: {
                federation: true,
                useIndexSignature: true,
                contextType: '../types/DataSourceContext#DataSourceContext',
            },
            plugins: ["typescript", "typescript-resolvers"]
        },
    },
};
exports.default = config;
//# sourceMappingURL=codegen.js.map