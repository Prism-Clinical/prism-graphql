/**
 * Document Import/Export Resolvers
 *
 * Resolvers for importing care plan documents (text → parsed → persisted)
 * and exporting care plans as documents (loaded → type bridge → generated text).
 *
 * All parsing, validation, and generation logic lives in prism-ml-infra.
 * These resolvers only orchestrate service calls and database operations.
 *
 * Improvements:
 * - Proper TypeScript types (no `any`)
 * - Parallel database operations where possible
 * - Validation enforcement before persistence
 * - Request correlation via requestId
 * - Structured error handling
 */

import {
  getParserClient,
  ValidationReport,
  CarePlanParseResult,
} from "../clients/parser-client";
import {
  toDocumentFormat,
  toPersistenceFormat,
  DocumentCarePlanInput,
} from "../clients/types/care-plan-bridge";
import { createLogger } from "../clients/logger";
import { generateRequestId } from "../clients/http-utils";
import type {
  CarePlan,
  CarePlanGoal,
  CarePlanIntervention,
  CreateCarePlanInput,
  AddGoalInput,
  AddInterventionInput,
} from "@shared/ciss-types";

// =============================================================================
// TYPES
// =============================================================================

interface CarePlanDataSource {
  getCarePlan: (id: string) => Promise<CarePlan | null>;
  getGoals: (carePlanId: string) => Promise<CarePlanGoal[]>;
  getInterventions: (carePlanId: string) => Promise<CarePlanIntervention[]>;
  createCarePlan: (input: CreateCarePlanInput) => Promise<CarePlan>;
  addGoal: (input: AddGoalInput) => Promise<CarePlanGoal>;
  addIntervention: (input: AddInterventionInput) => Promise<CarePlanIntervention>;
  addGoalsBatch?: (inputs: AddGoalInput[]) => Promise<CarePlanGoal[]>;
  addInterventionsBatch?: (inputs: AddInterventionInput[]) => Promise<CarePlanIntervention[]>;
  deleteCarePlan?: (id: string) => Promise<void>;
}

export interface DataSourceContext {
  dataSources: {
    carePlanDB: CarePlanDataSource;
  };
}

export interface ImportDocumentInput {
  documentText: string;
  patientId: string;
  createTemplate?: boolean;
  requireValidation?: boolean;
}

interface DocumentValidationViolation {
  rule: string;
  severity: string;
  message: string;
  line: number | null;
}

export interface DocumentValidationReport {
  isValid: boolean;
  violations: DocumentValidationViolation[];
  crossReferenceIssues: CrossReferenceIssue[];
}

interface CrossReferenceIssue {
  code: string;
  severity: string;
  message: string;
}

export interface ExportDocumentResult {
  documentText: string;
  filename: string;
}

export interface ImportDocumentResult {
  carePlan: CarePlan | null;
  validationReport: DocumentValidationReport;
  importError?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

const logger = createLogger("document-resolvers");

function mapValidationReport(report: ValidationReport): DocumentValidationReport {
  return {
    isValid: report.isValid,
    violations: report.violations.map((v) => ({
      rule: v.rule,
      severity: v.severity,
      message: v.message,
      line: v.line ?? null,
    })),
    crossReferenceIssues: [],
  };
}

function mapParseErrorsToValidationReport(
  parseResult: CarePlanParseResult
): DocumentValidationReport {
  return {
    isValid: false,
    violations:
      parseResult.errors?.map((e) => ({
        rule: e.code,
        severity: "ERROR",
        message: e.message,
        line: e.line ?? null,
      })) || [],
    crossReferenceIssues: [],
  };
}

// =============================================================================
// QUERY RESOLVERS
// =============================================================================

export const documentQueryResolvers = {
  /**
   * Export a care plan as a structured document.
   * Fetches goals and interventions in parallel for better performance.
   */
  exportCarePlanDocument: async (
    _: unknown,
    { carePlanId }: { carePlanId: string },
    { dataSources }: DataSourceContext
  ): Promise<ExportDocumentResult> => {
    const requestId = generateRequestId();
    logger.info("Exporting care plan document", { requestId, carePlanId });

    const carePlan = await dataSources.carePlanDB.getCarePlan(carePlanId);
    if (!carePlan) {
      throw new Error(`Care plan not found: ${carePlanId}`);
    }

    // Fetch goals and interventions in parallel
    const [goals, interventions] = await Promise.all([
      dataSources.carePlanDB.getGoals(carePlanId),
      dataSources.carePlanDB.getInterventions(carePlanId),
    ]);

    const documentInput = toDocumentFormat(carePlan, goals, interventions);

    const parserClient = getParserClient();
    const documentText = await parserClient.generate(documentInput, requestId);

    const filename = `${carePlan.title.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.txt`;

    logger.info("Care plan document exported", {
      requestId,
      carePlanId,
      filename,
      textLength: documentText.length,
    });

    return { documentText, filename };
  },

  /**
   * Validate a care plan document without persisting it.
   */
  validateCarePlanDocument: async (
    _: unknown,
    { documentText }: { documentText: string }
  ): Promise<DocumentValidationReport> => {
    const requestId = generateRequestId();
    logger.info("Validating care plan document", {
      requestId,
      textLength: documentText.length,
    });

    const parserClient = getParserClient();
    const report = await parserClient.validate(documentText, undefined, requestId);

    logger.info("Document validation completed", {
      requestId,
      isValid: report.isValid,
      violationCount: report.violations.length,
    });

    return mapValidationReport(report);
  },
};

// =============================================================================
// MUTATION RESOLVERS
// =============================================================================

export const documentMutationResolvers = {
  /**
   * Import a care plan document.
   *
   * Process:
   * 1. Parse and validate in a single call (or parallel if combined endpoint unavailable)
   * 2. Check validation result - reject if invalid and requireValidation is true
   * 3. Convert to persistence format
   * 4. Create care plan and add goals/interventions (with rollback on failure)
   *
   * If batch operations are available on the data source, uses them for better
   * performance and atomicity. Otherwise falls back to sequential inserts with
   * cleanup on failure.
   */
  importCarePlanDocument: async (
    _: unknown,
    { input }: { input: ImportDocumentInput },
    { dataSources }: DataSourceContext
  ): Promise<ImportDocumentResult> => {
    const requestId = generateRequestId();
    logger.info("Importing care plan document", {
      requestId,
      patientId: input.patientId,
      textLength: input.documentText.length,
      requireValidation: input.requireValidation ?? true,
    });

    const parserClient = getParserClient();

    // Use combined endpoint if available for efficiency
    const { parseResult, validationReport } = await parserClient.parseAndValidate(
      input.documentText,
      requestId
    );

    // Check validation - block import if validation fails and required
    const requireValidation = input.requireValidation ?? true;
    if (requireValidation && !validationReport.isValid) {
      logger.warn("Document validation failed, blocking import", {
        requestId,
        violationCount: validationReport.violations.length,
      });

      return {
        carePlan: null,
        validationReport: mapValidationReport(validationReport),
        importError: "Document validation failed. Fix violations before importing.",
      };
    }

    // Check parse result
    if (!parseResult.success) {
      logger.warn("Document parsing failed", {
        requestId,
        errorCount: parseResult.errors?.length ?? 0,
      });

      return {
        carePlan: null,
        validationReport: mapParseErrorsToValidationReport(parseResult),
        importError: "Document parsing failed.",
      };
    }

    // Convert to persistence format
    const { carePlan: carePlanInput, goals, interventions } = toPersistenceFormat(
      parseResult,
      input.patientId
    );

    // Create the care plan
    let carePlan: CarePlan;
    try {
      carePlan = await dataSources.carePlanDB.createCarePlan(carePlanInput);
    } catch (error) {
      logger.error(
        "Failed to create care plan",
        error instanceof Error ? error : undefined,
        { requestId }
      );
      throw new Error("Failed to create care plan");
    }

    // Add goals and interventions
    // Use batch operations if available, otherwise fall back to sequential with cleanup
    try {
      await addGoalsAndInterventions(
        dataSources.carePlanDB,
        carePlan.id,
        goals,
        interventions
      );
    } catch (error) {
      logger.error(
        "Failed to add goals/interventions, attempting cleanup",
        error instanceof Error ? error : undefined,
        { requestId, carePlanId: carePlan.id }
      );

      // Attempt to clean up the orphaned care plan
      if (dataSources.carePlanDB.deleteCarePlan) {
        try {
          await dataSources.carePlanDB.deleteCarePlan(carePlan.id);
          logger.info("Cleaned up orphaned care plan", {
            requestId,
            carePlanId: carePlan.id,
          });
        } catch (cleanupError) {
          logger.error(
            "Failed to clean up orphaned care plan",
            cleanupError instanceof Error ? cleanupError : undefined,
            { requestId, carePlanId: carePlan.id }
          );
        }
      }

      throw new Error(
        "Failed to import care plan: error adding goals/interventions"
      );
    }

    logger.info("Care plan document imported successfully", {
      requestId,
      carePlanId: carePlan.id,
      goalCount: goals.length,
      interventionCount: interventions.length,
    });

    return {
      carePlan,
      validationReport: mapValidationReport(validationReport),
    };
  },
};

/**
 * Add goals and interventions to a care plan.
 * Uses batch operations if available for better performance and atomicity.
 */
async function addGoalsAndInterventions(
  db: CarePlanDataSource,
  carePlanId: string,
  goals: Omit<AddGoalInput, "carePlanId">[],
  interventions: Omit<AddInterventionInput, "carePlanId">[]
): Promise<void> {
  const goalInputs: AddGoalInput[] = goals.map((g) => ({
    ...g,
    carePlanId,
  }));

  const interventionInputs: AddInterventionInput[] = interventions.map((i) => ({
    ...i,
    carePlanId,
  }));

  // Use batch operations if available
  if (db.addGoalsBatch && db.addInterventionsBatch) {
    await Promise.all([
      db.addGoalsBatch(goalInputs),
      db.addInterventionsBatch(interventionInputs),
    ]);
    return;
  }

  // Fall back to parallel individual inserts
  await Promise.all([
    ...goalInputs.map((g) => db.addGoal(g)),
    ...interventionInputs.map((i) => db.addIntervention(i)),
  ]);
}
