/**
 * Integration tests for Epic Patient Lookup flow.
 *
 * Requires running stack: `make compose-up` from prism-graphql root.
 * Tests the full path: gateway → epic-api-service → epic-mock-service.
 */

const GATEWAY_URL = process.env.TEST_GATEWAY_URL || 'http://localhost:4000/graphql';

async function graphql<T = Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>
): Promise<{ data?: T; errors?: Array<{ message: string }> }> {
  const response = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return response.json();
}

describe('Epic Patient Lookup — integration', () => {
  // Smoke check: verify epic-api-service is reachable through gateway
  it('gateway routes to epic-api-service', async () => {
    const result = await graphql('{ __typename }');
    expect(result.data?.__typename).toBe('Query');
  });

  describe('searchEpicPatients', () => {
    it('searches by family name and returns results', async () => {
      const result = await graphql<{
        searchEpicPatients: {
          results: Array<{
            epicPatientId: string;
            firstName: string | null;
            lastName: string | null;
            dateOfBirth: string | null;
            gender: string | null;
            mrn: string | null;
          }>;
          totalCount: number;
        };
      }>(
        `query SearchEpicPatients($input: EpicPatientSearchInput!) {
          searchEpicPatients(input: $input) {
            results {
              epicPatientId
              firstName
              lastName
              dateOfBirth
              gender
              mrn
            }
            totalCount
          }
        }`,
        { input: { family: 'Smith' } }
      );

      expect(result.errors).toBeUndefined();
      expect(result.data?.searchEpicPatients).toBeDefined();
      expect(result.data!.searchEpicPatients.results.length).toBeGreaterThan(0);
      expect(result.data!.searchEpicPatients.totalCount).toBeGreaterThan(0);

      // Verify result shape
      const patient = result.data!.searchEpicPatients.results[0];
      expect(patient.epicPatientId).toBeDefined();
      expect(patient.lastName?.toLowerCase()).toContain('smith');
    });

    it('searches by MRN identifier', async () => {
      const result = await graphql<{
        searchEpicPatients: {
          results: Array<{ mrn: string | null; epicPatientId: string }>;
          totalCount: number;
        };
      }>(
        `query SearchEpicPatients($input: EpicPatientSearchInput!) {
          searchEpicPatients(input: $input) {
            results { epicPatientId mrn }
            totalCount
          }
        }`,
        { input: { identifier: 'MRN12345' } }
      );

      expect(result.errors).toBeUndefined();
      expect(result.data?.searchEpicPatients.results.length).toBe(1);
      expect(result.data!.searchEpicPatients.results[0].mrn).toBe('MRN12345');
    });

    it('returns empty results for non-matching search', async () => {
      const result = await graphql<{
        searchEpicPatients: {
          results: Array<unknown>;
          totalCount: number;
        };
      }>(
        `query SearchEpicPatients($input: EpicPatientSearchInput!) {
          searchEpicPatients(input: $input) {
            results { epicPatientId }
            totalCount
          }
        }`,
        { input: { family: 'Zzzznonexistent' } }
      );

      expect(result.errors).toBeUndefined();
      expect(result.data?.searchEpicPatients.results).toHaveLength(0);
      expect(result.data?.searchEpicPatients.totalCount).toBe(0);
    });

    it('rejects empty search input', async () => {
      const result = await graphql(
        `query SearchEpicPatients($input: EpicPatientSearchInput!) {
          searchEpicPatients(input: $input) {
            results { epicPatientId }
            totalCount
          }
        }`,
        { input: {} }
      );

      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('search parameter');
    });

    it('rejects _count-only queries', async () => {
      const result = await graphql(
        `query SearchEpicPatients($input: EpicPatientSearchInput!) {
          searchEpicPatients(input: $input) {
            results { epicPatientId }
            totalCount
          }
        }`,
        { input: { _count: 5 } }
      );

      expect(result.errors).toBeDefined();
      expect(result.errors![0].message).toContain('search parameter');
    });
  });

  describe('epicPatientData', () => {
    it('fetches clinical data for a known patient', async () => {
      // First, find a patient to get their ID
      const searchResult = await graphql<{
        searchEpicPatients: {
          results: Array<{ epicPatientId: string }>;
        };
      }>(
        `query SearchEpicPatients($input: EpicPatientSearchInput!) {
          searchEpicPatients(input: $input) {
            results { epicPatientId }
          }
        }`,
        { input: { family: 'Smith' } }
      );

      const epicPatientId = searchResult.data!.searchEpicPatients.results[0].epicPatientId;

      // Now fetch clinical data
      const result = await graphql<{
        epicPatientData: {
          epicPatientId: string;
          demographics: {
            firstName: string;
            lastName: string;
          } | null;
          vitals: Array<{ type: string; value: number; unit: string }>;
          medications: Array<{ name: string; status: string }>;
          diagnoses: Array<{ code: string; display: string }>;
          errors: Array<{ dataType: string; message: string }>;
        };
      }>(
        `query GetEpicPatientData($epicPatientId: ID!) {
          epicPatientData(epicPatientId: $epicPatientId) {
            epicPatientId
            demographics {
              firstName
              lastName
            }
            vitals { type value unit }
            medications { name status }
            diagnoses { code display }
            errors { dataType message }
          }
        }`,
        { epicPatientId }
      );

      expect(result.errors).toBeUndefined();
      expect(result.data?.epicPatientData).toBeDefined();
      expect(result.data!.epicPatientData.epicPatientId).toBe(epicPatientId);
    });
  });

  describe('createClinicalSnapshot', () => {
    it('creates a clinical snapshot for a patient', async () => {
      // Find a patient first
      const searchResult = await graphql<{
        searchEpicPatients: {
          results: Array<{ epicPatientId: string }>;
        };
      }>(
        `query SearchEpicPatients($input: EpicPatientSearchInput!) {
          searchEpicPatients(input: $input) {
            results { epicPatientId }
          }
        }`,
        { input: { identifier: 'MRN12345' } }
      );

      const epicPatientId = searchResult.data!.searchEpicPatients.results[0].epicPatientId;

      // Create snapshot
      const result = await graphql<{
        createClinicalSnapshot: {
          snapshot: {
            id: string;
            epicPatientId: string;
            snapshotVersion: number;
            triggerEvent: string;
            createdAt: string;
          };
          isNew: boolean;
        };
      }>(
        `mutation CreateClinicalSnapshot($epicPatientId: ID!, $trigger: SnapshotTrigger!) {
          createClinicalSnapshot(epicPatientId: $epicPatientId, trigger: $trigger) {
            snapshot {
              id
              epicPatientId
              snapshotVersion
              triggerEvent
              createdAt
            }
            isNew
          }
        }`,
        { epicPatientId, trigger: 'MANUAL_REFRESH' }
      );

      expect(result.errors).toBeUndefined();
      expect(result.data?.createClinicalSnapshot).toBeDefined();
      expect(result.data!.createClinicalSnapshot.snapshot.epicPatientId).toBe(epicPatientId);
      expect(result.data!.createClinicalSnapshot.snapshot.snapshotVersion).toBeGreaterThanOrEqual(1);
    });
  });

  describe('full flow: search → data → snapshot', () => {
    it('completes the full patient lookup workflow', async () => {
      // Step 1: Search for patient
      const searchResult = await graphql<{
        searchEpicPatients: {
          results: Array<{
            epicPatientId: string;
            firstName: string | null;
            lastName: string | null;
            mrn: string | null;
          }>;
          totalCount: number;
        };
      }>(
        `query SearchEpicPatients($input: EpicPatientSearchInput!) {
          searchEpicPatients(input: $input) {
            results { epicPatientId firstName lastName mrn }
            totalCount
          }
        }`,
        { input: { family: 'Johnson' } }
      );

      expect(searchResult.errors).toBeUndefined();
      expect(searchResult.data!.searchEpicPatients.results.length).toBeGreaterThan(0);
      const patient = searchResult.data!.searchEpicPatients.results[0];

      // Step 2: Get clinical data
      const dataResult = await graphql<{
        epicPatientData: {
          epicPatientId: string;
          vitals: Array<unknown>;
          medications: Array<unknown>;
          diagnoses: Array<unknown>;
        };
      }>(
        `query GetEpicPatientData($epicPatientId: ID!) {
          epicPatientData(epicPatientId: $epicPatientId) {
            epicPatientId
            vitals { type value unit }
            medications { name status }
            diagnoses { code display }
          }
        }`,
        { epicPatientId: patient.epicPatientId }
      );

      expect(dataResult.errors).toBeUndefined();
      expect(dataResult.data!.epicPatientData.epicPatientId).toBe(patient.epicPatientId);

      // Step 3: Create clinical snapshot
      const snapshotResult = await graphql<{
        createClinicalSnapshot: {
          snapshot: { id: string; epicPatientId: string; snapshotVersion: number };
          isNew: boolean;
        };
      }>(
        `mutation CreateClinicalSnapshot($epicPatientId: ID!, $trigger: SnapshotTrigger!) {
          createClinicalSnapshot(epicPatientId: $epicPatientId, trigger: $trigger) {
            snapshot { id epicPatientId snapshotVersion }
            isNew
          }
        }`,
        { epicPatientId: patient.epicPatientId, trigger: 'MANUAL_REFRESH' }
      );

      expect(snapshotResult.errors).toBeUndefined();
      expect(snapshotResult.data!.createClinicalSnapshot.snapshot.epicPatientId).toBe(
        patient.epicPatientId
      );
    });
  });
});
