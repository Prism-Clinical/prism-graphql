import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { buildSubgraphSchema } from '@apollo/subgraph';
import gql from 'graphql-tag';
import axios from 'axios';
import { getExtractionClient, FHIRObservation } from './clients';

const typeDefs = gql`
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
    async epicPatientData(_: any, { epicPatientId }: { epicPatientId: string }) {
      try {
        const epicBaseUrl = process.env.EPIC_BASE_URL || 'http://epic-mock:8080';
        
        // Fetch patient demographics
        const patientResponse = await axios.get(`${epicBaseUrl}/Patient/${epicPatientId}`);
        const patient = patientResponse.data;

        // Fetch vitals
        const vitalsResponse = await axios.get(`${epicBaseUrl}/Observation`, {
          params: { patient: `Patient/${epicPatientId}`, category: 'vital-signs' }
        });

        // Fetch medications
        const medsResponse = await axios.get(`${epicBaseUrl}/MedicationRequest`, {
          params: { patient: `Patient/${epicPatientId}` }
        });

        // Fetch conditions
        const conditionsResponse = await axios.get(`${epicBaseUrl}/Condition`, {
          params: { patient: `Patient/${epicPatientId}` }
        });

        // Extract vitals via feature-extraction service, with fallback to raw observations
        let vitals: Array<{ type: string; value: number; unit: string; recordedDate: string }> = [];
        const rawEntries = vitalsResponse.data.entry || [];
        try {
          const observations: FHIRObservation[] = rawEntries.map((entry: any) => entry.resource);
          if (observations.length > 0) {
            const result = await getExtractionClient().extractVitals(observations);
            vitals = result.vitals.map((v) => ({
              type: v.type,
              value: v.normalizedValue,
              unit: v.normalizedUnit,
              recordedDate: v.timestamp || ''
            }));
          }
        } catch (extractionError) {
          console.warn('Feature extraction service unavailable, falling back to raw observations:', extractionError);
          vitals = rawEntries.map((entry: any) => ({
            type: entry.resource.code?.coding?.[0]?.display || 'Unknown',
            value: entry.resource.valueQuantity?.value || 0,
            unit: entry.resource.valueQuantity?.unit || '',
            recordedDate: entry.resource.effectiveDateTime || ''
          }));
        }

        return {
          epicPatientId,
          demographics: {
            firstName: patient.name?.[0]?.given?.[0] || '',
            lastName: patient.name?.[0]?.family || '',
            gender: patient.gender || '',
            dateOfBirth: patient.birthDate || '',
            mrn: patient.identifier?.[0]?.value || ''
          },
          vitals,
          medications: medsResponse.data.entry?.map((entry: any) => ({
            name: entry.resource.medicationCodeableConcept?.coding?.[0]?.display || 'Unknown',
            status: entry.resource.status || 'unknown',
            dosage: entry.resource.dosageInstruction?.[0]?.text || ''
          })) || [],
          diagnoses: conditionsResponse.data.entry?.map((entry: any) => ({
            code: entry.resource.code?.coding?.[0]?.code || '',
            display: entry.resource.code?.coding?.[0]?.display || 'Unknown',
            recordedDate: entry.resource.recordedDate || ''
          })) || [],
          lastSync: new Date().toISOString()
        };
      } catch (error) {
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
        await axios.get(`${epicBaseUrl}/health`);
        const responseTime = Date.now() - start;
        
        return {
          connected: true,
          lastConnectionTest: new Date().toISOString(),
          responseTime,
          errors: []
        };
      } catch (error) {
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
    async syncPatientDataFromEpic(_: any, { epicPatientId, dataTypes }: { epicPatientId: string, dataTypes: string[] }) {
      const start = Date.now();
      const syncedDataTypes: string[] = [];
      const errors: Array<{ dataType: string, message: string }> = [];
      let totalRecords = 0;

      try {
        const epicBaseUrl = process.env.EPIC_BASE_URL || 'http://epic-mock:8080';

        for (const dataType of dataTypes) {
          try {
            switch (dataType) {
              case 'DEMOGRAPHICS':
                await axios.get(`${epicBaseUrl}/Patient/${epicPatientId}`);
                syncedDataTypes.push(dataType);
                totalRecords += 1;
                break;
              case 'VITALS':
                const vitalsResponse = await axios.get(`${epicBaseUrl}/Observation`, {
                  params: { patient: `Patient/${epicPatientId}`, category: 'vital-signs' }
                });
                syncedDataTypes.push(dataType);
                totalRecords += vitalsResponse.data.entry?.length || 0;
                break;
              case 'MEDICATIONS':
                const medsResponse = await axios.get(`${epicBaseUrl}/MedicationRequest`, {
                  params: { patient: `Patient/${epicPatientId}` }
                });
                syncedDataTypes.push(dataType);
                totalRecords += medsResponse.data.entry?.length || 0;
                break;
              case 'DIAGNOSES':
                const conditionsResponse = await axios.get(`${epicBaseUrl}/Condition`, {
                  params: { patient: `Patient/${epicPatientId}` }
                });
                syncedDataTypes.push(dataType);
                totalRecords += conditionsResponse.data.entry?.length || 0;
                break;
            }
          } catch (error) {
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
      } catch (error) {
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
    const server = new ApolloServer({
      schema: buildSubgraphSchema({
        typeDefs,
        resolvers,
      }),
    });

    const { url } = await startStandaloneServer(server, {
      listen: { port: parseInt(process.env.PORT || '4006') },
    });

    console.log(`🚀 Epic API Service ready at ${url}`);
  } catch (error) {
    console.error('Failed to start Epic API service:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Failed to start Epic API service:', error);
  process.exit(1);
});