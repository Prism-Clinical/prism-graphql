import Query from "./Query";
import Mutation from "./Mutation";
import { RecommenderClient } from "../clients/recommender-client";

const resolvers: Record<string, any> = {
  Query,
  Mutation,
  Patient: {
    async recommendedCarePlans(
      patient: { id: string },
      args: { maxResults?: number; includeDrafts?: boolean },
      context: any
    ) {
      const { recommenderClient, pool } = context;

      // Get patient's active conditions from database
      const result = await pool.query(
        `SELECT condition_codes FROM care_plans
         WHERE patient_id = $1 AND status = 'ACTIVE'
         LIMIT 1`,
        [patient.id]
      );

      const conditionCodes = result.rows[0]?.condition_codes || [];

      if (conditionCodes.length === 0) {
        return {
          templates: [],
          drafts: [],
          processingTimeMs: 0,
          modelVersion: "no_conditions",
          queryMode: "SIMPLE",
        };
      }

      const response = await recommenderClient.recommendSimple({
        condition_codes: conditionCodes,
        max_results: args.maxResults || 5,
        include_drafts: args.includeDrafts ?? true,
      });

      return RecommenderClient.toGraphQL(response);
    },

    async engineRecommendations(
      patient: { id: string },
      args: { maxResults?: number; enablePersonalization?: boolean },
      context: any
    ) {
      const { recommenderClient, pool } = context;

      // Get patient's active conditions and demographics from database
      const result = await pool.query(
        `SELECT
           cp.condition_codes,
           p.date_of_birth,
           p.sex
         FROM care_plans cp
         JOIN patients p ON p.id = cp.patient_id
         WHERE cp.patient_id = $1 AND cp.status = 'ACTIVE'
         LIMIT 1`,
        [patient.id]
      );

      const conditionCodes = result.rows[0]?.condition_codes || [];

      if (conditionCodes.length === 0) {
        return {
          sessionId: "no-conditions",
          recommendations: [],
          layerSummaries: [],
          totalProcessingTimeMs: 0,
          engineVersion: "2.0.0",
        };
      }

      // Calculate age from date_of_birth if available
      let age: number | undefined;
      if (result.rows[0]?.date_of_birth) {
        const dob = new Date(result.rows[0].date_of_birth);
        const today = new Date();
        age = Math.floor((today.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      }

      const response = await recommenderClient.engineRecommend({
        patient_context: {
          condition_codes: conditionCodes,
          age,
          sex: result.rows[0]?.sex,
          patient_id: patient.id,
        },
        max_results: args.maxResults || 5,
        enable_personalization: args.enablePersonalization ?? true,
      });

      return RecommenderClient.engineRecommendToGraphQL(response);
    },
  },
};

export default resolvers;
