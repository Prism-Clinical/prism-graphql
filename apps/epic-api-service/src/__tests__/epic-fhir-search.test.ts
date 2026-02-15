/**
 * Tests for the searchPatients method on EpicFhirClient.
 *
 * Uses nock to mock HTTP calls to the FHIR endpoint.
 */

import nock from "nock";
import { EpicFhirClient } from "../clients/epic-fhir-client";

// Suppress structured logging during tests
jest.mock("../clients/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Disable auth for test client
jest.mock("../clients/epic-auth-client", () => ({
  getAuthClient: () => ({
    getAccessToken: jest.fn().mockResolvedValue("test-token"),
  }),
}));

const MOCK_BASE_URL = "http://epic-mock-test:8080";

describe("EpicFhirClient.searchPatients", () => {
  let client: EpicFhirClient;

  beforeAll(() => {
    client = new EpicFhirClient({
      baseUrl: MOCK_BASE_URL,
      authEnabled: false,
      timeout: 5000,
    });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it("searches by name and returns a FHIR Bundle", async () => {
    const mockBundle = {
      resourceType: "Bundle",
      type: "searchset",
      total: 1,
      entry: [
        {
          resource: {
            resourceType: "Patient",
            id: "patient-1",
            name: [{ use: "official", given: ["Sarah"], family: "Johnson" }],
            gender: "female",
            birthDate: "1985-03-15",
            identifier: [
              { type: { coding: [{ code: "MR" }] }, value: "MRN-001" },
            ],
          },
        },
      ],
    };

    nock(MOCK_BASE_URL)
      .get("/Patient")
      .query({ name: "Sarah" })
      .reply(200, mockBundle);

    const result = await client.searchPatients({ name: "Sarah" });

    expect(result.data.entry).toHaveLength(1);
    expect(result.data.entry![0].resource.name![0].given![0]).toBe("Sarah");
    expect(result.data.entry![0].resource.id).toBe("patient-1");
  });

  it("searches by family name, birthdate, and gender", async () => {
    const mockBundle = {
      resourceType: "Bundle",
      type: "searchset",
      total: 1,
      entry: [
        {
          resource: {
            resourceType: "Patient",
            id: "patient-2",
            name: [{ use: "official", given: ["James"], family: "Wilson" }],
            gender: "male",
            birthDate: "1972-08-20",
          },
        },
      ],
    };

    nock(MOCK_BASE_URL)
      .get("/Patient")
      .query({ family: "Wilson", birthdate: "1972-08-20", gender: "male" })
      .reply(200, mockBundle);

    const result = await client.searchPatients({
      family: "Wilson",
      birthdate: "1972-08-20",
      gender: "male",
    });

    expect(result.data.entry).toHaveLength(1);
    expect(result.data.entry![0].resource.gender).toBe("male");
  });

  it("searches by MRN identifier", async () => {
    const mockBundle = {
      resourceType: "Bundle",
      type: "searchset",
      total: 1,
      entry: [
        {
          resource: {
            resourceType: "Patient",
            id: "patient-3",
            name: [{ use: "official", given: ["Emily"], family: "Chen" }],
            identifier: [
              { type: { coding: [{ code: "MR" }] }, value: "MRN-12345" },
            ],
          },
        },
      ],
    };

    nock(MOCK_BASE_URL)
      .get("/Patient")
      .query({ identifier: "MRN-12345" })
      .reply(200, mockBundle);

    const result = await client.searchPatients({ identifier: "MRN-12345" });

    expect(result.data.entry).toHaveLength(1);
    expect(result.data.entry![0].resource.id).toBe("patient-3");
  });

  it("passes _count parameter to limit results", async () => {
    const mockBundle = {
      resourceType: "Bundle",
      type: "searchset",
      total: 0,
      entry: [] as Array<{ resource: { resourceType: string; id: string } }>,
    };

    nock(MOCK_BASE_URL)
      .get("/Patient")
      .query({ name: "Smith", _count: "5" })
      .reply(200, mockBundle);

    const result = await client.searchPatients({ name: "Smith", _count: 5 });

    expect(result.data).toBeDefined();
  });

  it("returns empty bundle when no patients match", async () => {
    const mockBundle = {
      resourceType: "Bundle",
      type: "searchset",
      total: 0,
    };

    nock(MOCK_BASE_URL)
      .get("/Patient")
      .query({ name: "NonexistentPatient" })
      .reply(200, mockBundle);

    const result = await client.searchPatients({ name: "NonexistentPatient" });

    expect(result.data.entry).toBeUndefined();
  });

  it("handles FHIR server errors", async () => {
    nock(MOCK_BASE_URL)
      .get("/Patient")
      .query({ name: "Error" })
      .reply(500, { issue: [{ severity: "error", diagnostics: "Server error" }] });

    await expect(
      client.searchPatients({ name: "Error" })
    ).rejects.toThrow();
  });

  it("omits undefined search params from the request", async () => {
    const mockBundle = {
      resourceType: "Bundle",
      type: "searchset",
      total: 0,
    };

    // Only name should be in query — no undefined params
    const scope = nock(MOCK_BASE_URL)
      .get("/Patient")
      .query({ given: "John" })
      .reply(200, mockBundle);

    await client.searchPatients({ given: "John" });

    expect(scope.isDone()).toBe(true);
  });
});
