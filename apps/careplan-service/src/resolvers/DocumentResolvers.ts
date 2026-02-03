/**
 * Document Import/Export Resolvers
 *
 * Resolvers for importing care plan documents (text → parsed → persisted)
 * and exporting care plans as documents (loaded → type bridge → generated text).
 *
 * All parsing, validation, and generation logic lives in prism-ml-infra.
 * These resolvers only orchestrate service calls and database operations.
 */

import { getParserClient } from "../clients/parser-client";
import {
  toDocumentFormat,
  toPersistenceFormat,
} from "../clients/types/care-plan-bridge";

interface DataSourceContext {
  dataSources: {
    carePlanDB: {
      getCarePlan: (id: string) => Promise<any>;
      getGoals: (carePlanId: string) => Promise<any[]>;
      getInterventions: (carePlanId: string) => Promise<any[]>;
      createCarePlan: (input: any) => Promise<any>;
      addGoal: (input: any) => Promise<any>;
      addIntervention: (input: any) => Promise<any>;
    };
  };
}

export const documentQueryResolvers = {
  exportCarePlanDocument: async (
    _: unknown,
    { carePlanId }: { carePlanId: string },
    { dataSources }: DataSourceContext
  ) => {
    const carePlan = await dataSources.carePlanDB.getCarePlan(carePlanId);
    if (!carePlan) {
      throw new Error(`Care plan not found: ${carePlanId}`);
    }

    const goals = await dataSources.carePlanDB.getGoals(carePlanId);
    const interventions =
      await dataSources.carePlanDB.getInterventions(carePlanId);

    const documentInput = toDocumentFormat(carePlan, goals, interventions);

    const parserClient = getParserClient();
    const documentText = await parserClient.generate(
      documentInput as unknown as Record<string, unknown>
    );

    const filename = `${carePlan.title.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.txt`;

    return { documentText, filename };
  },

  validateCarePlanDocument: async (
    _: unknown,
    { documentText }: { documentText: string }
  ) => {
    const parserClient = getParserClient();
    const report = await parserClient.validate(documentText);

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
  },
};

export const documentMutationResolvers = {
  importCarePlanDocument: async (
    _: unknown,
    {
      input,
    }: {
      input: { documentText: string; patientId: string; createTemplate?: boolean };
    },
    { dataSources }: DataSourceContext
  ) => {
    const parserClient = getParserClient();

    // Validate first
    const validationReport = await parserClient.validate(input.documentText);

    // Parse the document
    const parseResult = await parserClient.parse(input.documentText);

    if (!parseResult.success) {
      return {
        carePlan: null,
        validationReport: {
          isValid: false,
          violations:
            parseResult.errors?.map((e) => ({
              rule: e.code,
              severity: "ERROR",
              message: e.message,
              line: e.line ?? null,
            })) || [],
          crossReferenceIssues: [],
        },
      };
    }

    // Convert to persistence format
    const { carePlan: carePlanInput, goals, interventions } =
      toPersistenceFormat(parseResult, input.patientId);

    // Create the care plan
    const carePlan = await dataSources.carePlanDB.createCarePlan(carePlanInput);

    // Add goals and interventions
    for (const goal of goals) {
      await dataSources.carePlanDB.addGoal({
        ...goal,
        carePlanId: carePlan.id,
      });
    }
    for (const intervention of interventions) {
      await dataSources.carePlanDB.addIntervention({
        ...intervention,
        carePlanId: carePlan.id,
      });
    }

    return {
      carePlan,
      validationReport: {
        isValid: validationReport.isValid,
        violations: validationReport.violations.map((v) => ({
          rule: v.rule,
          severity: v.severity,
          message: v.message,
          line: v.line ?? null,
        })),
        crossReferenceIssues: [],
      },
    };
  },
};
