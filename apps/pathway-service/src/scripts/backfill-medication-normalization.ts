/**
 * One-off D14 backfill: normalise every Medication node name in ACTIVE and
 * DRAFT pathways. Run on live after this plan deploys and before generation
 * is used (plan 05). The live cache holds 0 rows, so without this every plan
 * blocks on SAFETY_DATA_UNAVAILABLE.
 *
 *   export POSTGRES_PASSWORD=…   # pm2 env 0, ANSI-stripped (CLAUDE.md)
 *   node apps/pathway-service/dist/scripts/backfill-medication-normalization.js --dry-run
 *   node apps/pathway-service/dist/scripts/backfill-medication-normalization.js
 *
 * Then triage what RxNav could not map through the unnormalizedMedications
 * admin queue and manuallyResolveMedicationNormalization.
 */
import { Pool } from 'pg';
import { pathwayMedicationNames, prewarmPathwayMedications } from '../services/medications/prewarm-pathway';

export async function backfill(
  pool: Pool,
  opts: { dryRun: boolean; log: (line: string) => void },
): Promise<{ pathways: number; succeeded: number; failed: number }> {
  const { rows } = await pool.query<{ id: string; title: string; version: string; status: string }>(
    `SELECT id, title, version, status FROM pathway_graph_index
      WHERE status IN ('ACTIVE', 'DRAFT') ORDER BY title, version`,
  );
  let succeeded = 0;
  let failed = 0;
  for (const p of rows) {
    if (opts.dryRun) {
      const names = await pathwayMedicationNames(pool, p.id);
      opts.log(`${p.status} ${p.title}@${p.version}: ${names.join(', ') || '(no medications)'}`);
      continue;
    }
    const r = await prewarmPathwayMedications(pool, p.id);
    succeeded += r.succeeded;
    failed += r.failed;
    opts.log(`${p.status} ${p.title}@${p.version}: ${r.succeeded}/${r.total} normalised`);
  }
  return { pathways: rows.length, succeeded, failed };
}

if (require.main === module) {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'prism',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB ?? 'prism_db',
  });
  // Graph reads go through Apache AGE, as in the service itself.
  pool.on('connect', (client) => {
    client.query(`LOAD 'age'; SET search_path = ag_catalog, "$user", public;`).catch((): void => undefined);
  });
  backfill(pool, { dryRun: process.argv.includes('--dry-run'), log: (line) => console.log(line) })
    .then((s) => console.log(`${s.pathways} pathways: ${s.succeeded} normalised, ${s.failed} not (see the unnormalizedMedications admin queue)`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
