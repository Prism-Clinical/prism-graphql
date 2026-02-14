/**
 * Quick test script for Epic FHIR sandbox connection.
 * Run: EPIC_AUTH_ENABLED=true EPIC_CLIENT_ID=b071ea66-9918-43f2-ae82-9a67a322ca36 npx ts-node test-sandbox.ts
 */

import { EpicAuthClient, setAuthClient } from "./src/clients/epic-auth-client";
import { EpicFhirClient } from "./src/clients/epic-fhir-client";

async function runTest() {
  console.log("=== Testing Epic FHIR Sandbox Connection ===\n");

  const authClient = new EpicAuthClient({
    clientId: "b071ea66-9918-43f2-ae82-9a67a322ca36",
    tokenUrl:
      "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token",
    privateKeyPath:
      "/Users/wyethjackson_1/codebase/prism-codebase/prism-graphql/keys/epic-private-key.pem",
    kid: "prism-clinical-sandbox",
    scope:
      "system/Patient.rs system/Observation.rs system/MedicationRequest.rs system/Condition.rs",
    tokenRefreshBufferSeconds: 30,
  });
  setAuthClient(authClient);

  // Step 1: Get token
  console.log("1. Requesting access token from Epic...");
  try {
    const token = await authClient.getAccessToken();
    console.log("   Token acquired:", token.substring(0, 40) + "...\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("   Token request FAILED:", msg);
    return;
  }

  const fhirClient = new EpicFhirClient({
    baseUrl: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
    authEnabled: true,
    timeout: 30000,
  });

  // Step 2: Fetch patient
  const testPatientId = "erXuFYUfucBZaryVksYEcMg3";
  console.log("2. Fetching test patient (Camila Lopez)...");
  try {
    const res = await fhirClient.getPatient(testPatientId);
    const p = res.data;
    console.log(
      "   Name:",
      p.name?.[0]?.given?.join(" "),
      p.name?.[0]?.family
    );
    console.log("   Gender:", p.gender);
    console.log("   DOB:", p.birthDate);
    console.log();
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    console.error(
      "   Patient FAILED:",
      e.response?.status,
      e.response?.data || e.message
    );
  }

  // Step 3: Fetch vitals
  console.log("3. Fetching vital signs...");
  try {
    const res = await fhirClient.getObservations(testPatientId, "vital-signs");
    const entries = res.data.entry || [];
    console.log("   Vitals found:", entries.length);
    entries.slice(0, 3).forEach((e) => {
      const obs = e.resource;
      console.log(
        "   -",
        obs.code?.coding?.[0]?.display,
        obs.valueQuantity?.value,
        obs.valueQuantity?.unit
      );
    });
    console.log();
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    console.error(
      "   Vitals FAILED:",
      e.response?.status,
      e.response?.data || e.message
    );
  }

  // Step 4: Fetch medications
  console.log("4. Fetching medications...");
  try {
    const res = await fhirClient.getMedicationRequests(testPatientId);
    const entries = res.data.entry || [];
    console.log("   Medications found:", entries.length);
    entries.slice(0, 3).forEach((e) => {
      const med = e.resource;
      console.log(
        "   -",
        med.medicationCodeableConcept?.coding?.[0]?.display,
        "(" + (med.status || "unknown") + ")"
      );
    });
    console.log();
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    console.error(
      "   Medications FAILED:",
      e.response?.status,
      e.response?.data || e.message
    );
  }

  // Step 5: Fetch conditions
  console.log("5. Fetching conditions...");
  try {
    const res = await fhirClient.getConditions(testPatientId);
    const entries = res.data.entry || [];
    console.log("   Conditions found:", entries.length);
    entries.slice(0, 3).forEach((e) => {
      const cond = e.resource;
      console.log("   -", cond.code?.coding?.[0]?.display);
    });
    console.log();
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    console.error(
      "   Conditions FAILED:",
      e.response?.status,
      e.response?.data || e.message
    );
  }

  console.log("=== Test Complete ===");
}

runTest().catch(console.error);
