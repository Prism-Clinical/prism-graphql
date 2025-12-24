"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("@apollo/server");
const standalone_1 = require("@apollo/server/standalone");
const subgraph_1 = require("@apollo/subgraph");
const graphql_tag_1 = __importDefault(require("graphql-tag"));
const axios_1 = __importDefault(require("axios"));
const typeDefs = (0, graphql_tag_1.default) `
  extend schema @link(url: "https://specs.apollo.dev/federation/v2.10", import: ["@key", "@external", "@shareable"])

  type EpicPatientData @key(fields: "epicPatientId") {
    epicPatientId: ID!
    demographics: PatientDemographics
    vitals: [Vital!]!
    medications: [Medication!]!
    diagnoses: [Diagnosis!]!
    lastSync: String
  }

  type PatientDemographics {
    firstName: String
    lastName: String
    gender: String
    dateOfBirth: String
    mrn: String
  }

  type Vital {
    type: String!
    value: Float!
    unit: String!
    recordedDate: String!
  }

  type Medication {
    name: String!
    status: String!
    dosage: String
  }

  type Diagnosis {
    code: String!
    display: String!
    recordedDate: String!
  }

  type EpicConnectionStatus {
    connected: Boolean!
    lastConnectionTest: String!
    responseTime: Int!
    errors: [String!]!
  }

  type SyncResult {
    success: Boolean!
    syncedDataTypes: [String!]!
    totalRecords: Int!
    processingTime: Int!
    errors: [SyncError!]!
  }

  type SyncError {
    dataType: String!
    message: String!
  }

  enum EpicDataType {
    DEMOGRAPHICS
    VITALS
    MEDICATIONS
    DIAGNOSES
  }

  type Query {
    epicPatientData(epicPatientId: ID!): EpicPatientData
    epicConnectionStatus: EpicConnectionStatus!
  }

  type Mutation {
    syncPatientDataFromEpic(epicPatientId: ID!, dataTypes: [EpicDataType!]!): SyncResult!
  }
`;
const resolvers = {
    Query: {
        async epicPatientData(_, { epicPatientId }) {
            try {
                const epicBaseUrl = process.env.EPIC_BASE_URL || 'http://epic-mock:8080';
                const patientResponse = await axios_1.default.get(`${epicBaseUrl}/Patient/${epicPatientId}`);
                const patient = patientResponse.data;
                const vitalsResponse = await axios_1.default.get(`${epicBaseUrl}/Observation`, {
                    params: { patient: `Patient/${epicPatientId}`, category: 'vital-signs' }
                });
                const medsResponse = await axios_1.default.get(`${epicBaseUrl}/MedicationRequest`, {
                    params: { patient: `Patient/${epicPatientId}` }
                });
                const conditionsResponse = await axios_1.default.get(`${epicBaseUrl}/Condition`, {
                    params: { patient: `Patient/${epicPatientId}` }
                });
                return {
                    epicPatientId,
                    demographics: {
                        firstName: patient.name?.[0]?.given?.[0] || '',
                        lastName: patient.name?.[0]?.family || '',
                        gender: patient.gender || '',
                        dateOfBirth: patient.birthDate || '',
                        mrn: patient.identifier?.[0]?.value || ''
                    },
                    vitals: vitalsResponse.data.entry?.map((entry) => ({
                        type: entry.resource.code?.coding?.[0]?.display || 'Unknown',
                        value: entry.resource.valueQuantity?.value || 0,
                        unit: entry.resource.valueQuantity?.unit || '',
                        recordedDate: entry.resource.effectiveDateTime || ''
                    })) || [],
                    medications: medsResponse.data.entry?.map((entry) => ({
                        name: entry.resource.medicationCodeableConcept?.coding?.[0]?.display || 'Unknown',
                        status: entry.resource.status || 'unknown',
                        dosage: entry.resource.dosageInstruction?.[0]?.text || ''
                    })) || [],
                    diagnoses: conditionsResponse.data.entry?.map((entry) => ({
                        code: entry.resource.code?.coding?.[0]?.code || '',
                        display: entry.resource.code?.coding?.[0]?.display || 'Unknown',
                        recordedDate: entry.resource.recordedDate || ''
                    })) || [],
                    lastSync: new Date().toISOString()
                };
            }
            catch (error) {
                console.error('Error fetching Epic patient data:', error);
                return {
                    epicPatientId,
                    demographics: null,
                    vitals: [],
                    medications: [],
                    diagnoses: [],
                    lastSync: new Date().toISOString()
                };
            }
        },
        async epicConnectionStatus() {
            const start = Date.now();
            try {
                const epicBaseUrl = process.env.EPIC_BASE_URL || 'http://epic-mock:8080';
                await axios_1.default.get(`${epicBaseUrl}/health`);
                const responseTime = Date.now() - start;
                return {
                    connected: true,
                    lastConnectionTest: new Date().toISOString(),
                    responseTime,
                    errors: []
                };
            }
            catch (error) {
                const responseTime = Date.now() - start;
                return {
                    connected: false,
                    lastConnectionTest: new Date().toISOString(),
                    responseTime,
                    errors: [error instanceof Error ? error.message : 'Unknown error']
                };
            }
        }
    },
    Mutation: {
        async syncPatientDataFromEpic(_, { epicPatientId, dataTypes }) {
            const start = Date.now();
            const syncedDataTypes = [];
            const errors = [];
            let totalRecords = 0;
            try {
                const epicBaseUrl = process.env.EPIC_BASE_URL || 'http://epic-mock:8080';
                for (const dataType of dataTypes) {
                    try {
                        switch (dataType) {
                            case 'DEMOGRAPHICS':
                                await axios_1.default.get(`${epicBaseUrl}/Patient/${epicPatientId}`);
                                syncedDataTypes.push(dataType);
                                totalRecords += 1;
                                break;
                            case 'VITALS':
                                const vitalsResponse = await axios_1.default.get(`${epicBaseUrl}/Observation`, {
                                    params: { patient: `Patient/${epicPatientId}`, category: 'vital-signs' }
                                });
                                syncedDataTypes.push(dataType);
                                totalRecords += vitalsResponse.data.entry?.length || 0;
                                break;
                            case 'MEDICATIONS':
                                const medsResponse = await axios_1.default.get(`${epicBaseUrl}/MedicationRequest`, {
                                    params: { patient: `Patient/${epicPatientId}` }
                                });
                                syncedDataTypes.push(dataType);
                                totalRecords += medsResponse.data.entry?.length || 0;
                                break;
                            case 'DIAGNOSES':
                                const conditionsResponse = await axios_1.default.get(`${epicBaseUrl}/Condition`, {
                                    params: { patient: `Patient/${epicPatientId}` }
                                });
                                syncedDataTypes.push(dataType);
                                totalRecords += conditionsResponse.data.entry?.length || 0;
                                break;
                        }
                    }
                    catch (error) {
                        errors.push({
                            dataType,
                            message: error instanceof Error ? error.message : 'Unknown error'
                        });
                    }
                }
                return {
                    success: errors.length === 0,
                    syncedDataTypes,
                    totalRecords,
                    processingTime: Date.now() - start,
                    errors
                };
            }
            catch (error) {
                return {
                    success: false,
                    syncedDataTypes,
                    totalRecords,
                    processingTime: Date.now() - start,
                    errors: [{ dataType: 'ALL', message: error instanceof Error ? error.message : 'Unknown error' }]
                };
            }
        }
    }
};
async function main() {
    try {
        const server = new server_1.ApolloServer({
            schema: (0, subgraph_1.buildSubgraphSchema)({
                typeDefs,
                resolvers,
            }),
        });
        const { url } = await (0, standalone_1.startStandaloneServer)(server, {
            listen: { port: parseInt(process.env.PORT || '4006') },
        });
        console.log(`🚀 Epic API Service ready at ${url}`);
    }
    catch (error) {
        console.error('Failed to start Epic API service:', error);
        process.exit(1);
    }
}
main().catch((error) => {
    console.error('Failed to start Epic API service:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map