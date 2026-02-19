/**
 * Patient Clinical Data Mappers
 *
 * Pure functions that convert snapshot DB row types (DiagnosisOut, MedicationOut,
 * AllergyOut) into simplified frontend-friendly types for the Patient federation
 * extension (PatientCondition, PatientMedication, PatientAllergy).
 */

import type {
  DiagnosisOut,
  MedicationOut,
  AllergyOut,
  CodeableConceptOut,
  AllergyReactionOut,
} from "./transforms";

// =============================================================================
// Frontend-Friendly Output Types
// =============================================================================

export interface PatientCondition {
  id: string;
  name: string;
  code: string;
  codeSystem: string | null;
  status: "ACTIVE" | "RESOLVED" | "INACTIVE";
  onsetDate: string;
}

export interface PatientMedication {
  id: string | null;
  name: string;
  status: "ACTIVE" | "DISCONTINUED";
  dosage: string | null;
  frequency: string | null;
}

export interface PatientAllergy {
  id: string | null;
  allergen: string;
  reaction: string | null;
  severity: "MILD" | "MODERATE" | "SEVERE";
}

// =============================================================================
// Helpers
// =============================================================================

function joinNonNull(values: Array<string | null>): string | null {
  const filtered = values.filter(
    (v): v is string => v != null && v.length > 0
  );
  if (filtered.length === 0) return null;
  return filtered.join(" \u00b7 ");
}

function extractAllergen(code: CodeableConceptOut | null): string {
  if (!code) return "Unknown allergen";
  if (code.text) return code.text;

  const displays = code.coding
    .map((c) => c.display)
    .filter((d): d is string => d != null && d.length > 0);

  if (displays.length === 0) return "Unknown allergen";
  return displays.join(" \u00b7 ");
}

function extractReactions(reactions: AllergyReactionOut[]): string | null {
  if (reactions.length === 0) return null;

  const texts = reactions.flatMap((r) =>
    r.manifestations.map((m) => m.text ?? m.coding[0]?.display ?? null)
  );

  return joinNonNull(texts);
}

function mapClinicalStatus(
  clinicalStatus: CodeableConceptOut | null
): "ACTIVE" | "RESOLVED" | "INACTIVE" {
  const code = clinicalStatus?.coding[0]?.code;
  if (code === "active") return "ACTIVE";
  if (code === "resolved") return "RESOLVED";
  return "INACTIVE";
}

function mapMedicationStatus(status: string): "ACTIVE" | "DISCONTINUED" {
  if (status === "active") return "ACTIVE";
  return "DISCONTINUED";
}

function mapCriticality(
  criticality: string | null
): "MILD" | "MODERATE" | "SEVERE" {
  if (criticality === "high") return "SEVERE";
  if (criticality === "low") return "MILD";
  return "MODERATE";
}

// =============================================================================
// Mapping Functions
// =============================================================================

export function mapConditions(diagnoses: DiagnosisOut[]): PatientCondition[] {
  return diagnoses.map((d, index) => ({
    id: d.id ?? `condition-${index}`,
    name: d.display,
    code: d.code,
    codeSystem: d.codeDetail?.coding[0]?.system ?? null,
    status: mapClinicalStatus(d.clinicalStatus),
    onsetDate: d.recordedDate,
  }));
}

export function mapMedications(medications: MedicationOut[]): PatientMedication[] {
  return medications.map((m) => ({
    id: m.id,
    name: m.name,
    status: mapMedicationStatus(m.status),
    dosage: joinNonNull(m.dosageInstructions.map((d) => d.text)),
    frequency: joinNonNull(m.dosageInstructions.map((d) => d.timing)),
  }));
}

export function mapAllergies(allergies: AllergyOut[]): PatientAllergy[] {
  return allergies.map((a) => ({
    id: a.id,
    allergen: extractAllergen(a.code),
    reaction: extractReactions(a.reactions),
    severity: mapCriticality(a.criticality),
  }));
}
