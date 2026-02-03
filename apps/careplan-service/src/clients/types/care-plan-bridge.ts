/**
 * Care Plan Type Bridge
 *
 * Maps between the document-centric CarePlan types returned by the
 * care-plan-parser service and the persistence-centric CarePlan types
 * from @shared/ciss-types used by prism-graphql.
 */

import type {
  CarePlan,
  CarePlanGoal,
  CarePlanIntervention,
  GoalPriority,
  InterventionType,
  CreateCarePlanInput,
  AddGoalInput,
  AddInterventionInput,
} from "@shared/ciss-types";
import type { CarePlanParseResult } from "../parser-client";

/**
 * Input structure expected by the generate endpoint.
 */
export interface DocumentCarePlanInput {
  metadata: {
    title: string;
    category: string;
    version: string;
    author: string;
    date: string;
    status: string;
    guidelineSource?: string;
    evidenceGrade?: string;
  };
  codes: {
    conditions: Array<{ code: string; system: string; description: string }>;
    medications: Array<{ code: string; system: string; description: string }>;
    labs: Array<{ code: string; system: string; description: string }>;
    procedures: Array<{ code: string; system: string; description: string }>;
  };
  goals: Array<{
    description: string;
    targetValue?: string;
    targetDate?: string;
    priority: string;
    status?: string;
  }>;
  interventions: Array<{
    type: string;
    description: string;
    frequency?: string;
    responsibleParty?: string;
    notes?: string;
  }>;
}

/**
 * Map GoalPriority between models.
 * Both use HIGH, MEDIUM, LOW but we map explicitly for safety.
 */
function mapGoalPriority(priority: string): GoalPriority {
  const map: Record<string, GoalPriority> = {
    HIGH: "HIGH" as GoalPriority,
    MEDIUM: "MEDIUM" as GoalPriority,
    LOW: "LOW" as GoalPriority,
  };
  const result = map[priority.toUpperCase()];
  if (!result) {
    throw new Error(`Unknown goal priority: ${priority}`);
  }
  return result;
}

/**
 * Map InterventionType between models.
 */
function mapInterventionType(type: string): InterventionType {
  const map: Record<string, InterventionType> = {
    MEDICATION: "MEDICATION" as InterventionType,
    PROCEDURE: "PROCEDURE" as InterventionType,
    LIFESTYLE: "LIFESTYLE" as InterventionType,
    MONITORING: "MONITORING" as InterventionType,
    REFERRAL: "REFERRAL" as InterventionType,
    EDUCATION: "EDUCATION" as InterventionType,
    FOLLOW_UP: "FOLLOW_UP" as InterventionType,
  };
  const result = map[type.toUpperCase()];
  if (!result) {
    throw new Error(`Unknown intervention type: ${type}`);
  }
  return result;
}

/**
 * Convert a persistence-centric CarePlan + goals + interventions into
 * the document format expected by the generate endpoint.
 */
export function toDocumentFormat(
  carePlan: CarePlan,
  goals: CarePlanGoal[],
  interventions: CarePlanIntervention[]
): DocumentCarePlanInput {
  return {
    metadata: {
      title: carePlan.title,
      category: "CHRONIC_DISEASE",
      version: "1.0",
      author: carePlan.createdBy,
      date: carePlan.startDate,
      status: carePlan.status,
    },
    codes: {
      conditions: carePlan.conditionCodes.map((code) => ({
        code,
        system: "ICD-10",
        description: code,
      })),
      medications: [],
      labs: [],
      procedures: [],
    },
    goals: goals.map((g) => ({
      description: g.description,
      targetValue: g.targetValue ?? undefined,
      targetDate: g.targetDate ?? undefined,
      priority: g.priority,
      status: g.status,
    })),
    interventions: interventions.map((i) => ({
      type: i.type,
      description: i.description,
      frequency: i.frequency ?? undefined,
    })),
  };
}

/**
 * Convert a parsed document into persistence-centric CreateCarePlanInput
 * plus arrays of goal and intervention inputs.
 */
export function toPersistenceFormat(
  parsed: CarePlanParseResult,
  patientId: string
): {
  carePlan: CreateCarePlanInput;
  goals: Omit<AddGoalInput, "carePlanId">[];
  interventions: Omit<AddInterventionInput, "carePlanId">[];
} {
  if (!parsed.success || !parsed.carePlan) {
    throw new Error("Cannot convert failed parse result to persistence format");
  }

  const doc = parsed.carePlan;

  const carePlan: CreateCarePlanInput = {
    patientId,
    title: doc.metadata.title,
    conditionCodes: doc.codes.conditions.map((c) => c.code),
    startDate: doc.metadata.date,
  };

  const goals: Omit<AddGoalInput, "carePlanId">[] = doc.goals.map((g) => ({
    description: g.description,
    targetValue: g.targetValue,
    targetDate: g.targetDate,
    priority: mapGoalPriority(g.priority),
    guidelineReference: doc.metadata.guidelineSource,
  }));

  const interventions: Omit<AddInterventionInput, "carePlanId">[] =
    doc.interventions.map((i) => ({
      type: mapInterventionType(i.type),
      description: i.description,
      frequency: i.frequency,
    }));

  return { carePlan, goals, interventions };
}
