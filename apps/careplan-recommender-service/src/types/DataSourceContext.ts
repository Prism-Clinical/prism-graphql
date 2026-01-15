import { Pool } from "pg";
import { Redis } from "ioredis";
import { RecommenderClient } from "../clients/recommender-client";

export interface DataSourceContext {
  pool: Pool;
  redis: Redis;
  recommenderClient: RecommenderClient;
}
