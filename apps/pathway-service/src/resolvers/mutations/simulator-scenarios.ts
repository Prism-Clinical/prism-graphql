/**
 * Resolvers for `simulator_scenarios` — saved synthetic-patient scenarios
 * the admin uses to regression-test pathways. See migration 054 for the
 * underlying schema.
 *
 * Surface:
 *   Query.simulatorScenarios          list (most-recent first)
 *   Query.simulatorScenario(id)       single
 *   Mutation.saveSimulatorScenario    create or update-by-id
 *   Mutation.deleteSimulatorScenario  delete by id
 */

import { DataSourceContext } from '../../types';

export interface CodeInputPayload {
  code: string;
  system: string;
  display?: string | null;
}

export interface LabResultInputPayload {
  code: string;
  system: string;
  value?: number | null;
  unit?: string | null;
  date?: string | null;
  display?: string | null;
}

export interface SaveSimulatorScenarioInput {
  /** When omitted, creates a new scenario; when provided, updates in place. */
  id?: string;
  name: string;
  description?: string;
  conditionCodes?: CodeInputPayload[];
  medications?: CodeInputPayload[];
  allergies?: CodeInputPayload[];
  labResults?: LabResultInputPayload[];
  /** Structured uncoded numeric data (BP, HR, SpO2, weight, height, custom). */
  vitals?: Record<string, unknown>;
  includeDraftPathways?: boolean;
}

interface SimulatorScenarioRow {
  id: string;
  name: string;
  description: string | null;
  condition_codes: CodeInputPayload[];
  medications: CodeInputPayload[];
  allergies: CodeInputPayload[];
  lab_results: LabResultInputPayload[];
  vitals: Record<string, unknown>;
  include_draft_pathways: boolean;
  created_at: Date;
  updated_at: Date;
}

function formatScenario(row: SimulatorScenarioRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    conditionCodes: row.condition_codes ?? [],
    medications: row.medications ?? [],
    allergies: row.allergies ?? [],
    labResults: row.lab_results ?? [],
    vitals: row.vitals ?? {},
    includeDraftPathways: row.include_draft_pathways,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export const simulatorScenarioQueries = {
  async simulatorScenarios(_p: unknown, _args: unknown, context: DataSourceContext) {
    const { rows } = await context.pool.query<SimulatorScenarioRow>(
      `SELECT id, name, description, condition_codes, medications, allergies,
              lab_results, vitals, include_draft_pathways, created_at, updated_at
       FROM simulator_scenarios
       ORDER BY updated_at DESC`,
    );
    return rows.map(formatScenario);
  },

  async simulatorScenario(_p: unknown, args: { id: string }, context: DataSourceContext) {
    const { rows } = await context.pool.query<SimulatorScenarioRow>(
      `SELECT id, name, description, condition_codes, medications, allergies,
              lab_results, vitals, include_draft_pathways, created_at, updated_at
       FROM simulator_scenarios
       WHERE id = $1`,
      [args.id],
    );
    return rows[0] ? formatScenario(rows[0]) : null;
  },
};

export const simulatorScenarioMutations = {
  async saveSimulatorScenario(
    _p: unknown,
    args: { input: SaveSimulatorScenarioInput },
    context: DataSourceContext,
  ) {
    const input = args.input;
    const conds = input.conditionCodes ?? [];
    const meds = input.medications ?? [];
    const allergies = input.allergies ?? [];
    const labs = input.labResults ?? [];
    const vitals = input.vitals ?? {};
    const includeDrafts = input.includeDraftPathways ?? true;

    if (input.id) {
      const { rows } = await context.pool.query<SimulatorScenarioRow>(
        `UPDATE simulator_scenarios
            SET name = $2,
                description = $3,
                condition_codes = $4::jsonb,
                medications = $5::jsonb,
                allergies = $6::jsonb,
                lab_results = $7::jsonb,
                vitals = $8::jsonb,
                include_draft_pathways = $9,
                updated_at = NOW()
          WHERE id = $1
        RETURNING id, name, description, condition_codes, medications, allergies,
                  lab_results, vitals, include_draft_pathways, created_at, updated_at`,
        [
          input.id,
          input.name,
          input.description ?? null,
          JSON.stringify(conds),
          JSON.stringify(meds),
          JSON.stringify(allergies),
          JSON.stringify(labs),
          JSON.stringify(vitals),
          includeDrafts,
        ],
      );
      if (!rows[0]) throw new Error(`Scenario ${input.id} not found`);
      return formatScenario(rows[0]);
    }

    // Create — fails on unique name conflict so callers can prompt for a
    // different name.
    const { rows } = await context.pool.query<SimulatorScenarioRow>(
      `INSERT INTO simulator_scenarios
         (name, description, condition_codes, medications, allergies,
          lab_results, vitals, include_draft_pathways)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8)
       RETURNING id, name, description, condition_codes, medications, allergies,
                 lab_results, vitals, include_draft_pathways, created_at, updated_at`,
      [
        input.name,
        input.description ?? null,
        JSON.stringify(conds),
        JSON.stringify(meds),
        JSON.stringify(allergies),
        JSON.stringify(labs),
        JSON.stringify(vitals),
        includeDrafts,
      ],
    );
    return formatScenario(rows[0]);
  },

  async deleteSimulatorScenario(
    _p: unknown,
    args: { id: string },
    context: DataSourceContext,
  ): Promise<boolean> {
    const res = await context.pool.query(
      `DELETE FROM simulator_scenarios WHERE id = $1`,
      [args.id],
    );
    return (res.rowCount ?? 0) > 0;
  },
};
