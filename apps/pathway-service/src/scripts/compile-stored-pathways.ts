// apps/pathway-service/src/scripts/compile-stored-pathways.ts
import { Pool } from 'pg';
import { performance } from 'perf_hooks';
import { compilePathway } from '../services/compiler/compile';
import { loadStoredCompileInput } from '../services/compiler/stored-input';

/** Read-only: compile every stored pathway and report. Used to record the corpus before and after phase 1. */
export async function compileAll(pool: Pool, log: (line: string) => void): Promise<{ total: number; ok: number }> {
  const { rows } = await pool.query<{ id: string; logical_id: string; version: string; status: string }>(
    'SELECT id, logical_id, version, status FROM pathway_graph_index ORDER BY logical_id, version',
  );
  let ok = 0;
  for (const p of rows) {
    const label = `${p.status.padEnd(8)} ${p.logical_id}@${p.version}`;
    const input = await loadStoredCompileInput(pool, p.id);
    if (!input) { log(`SKIP  ${label} (no stored graph)`); continue; }
    const t = performance.now();
    const r = compilePathway(input);
    const ms = Math.round(performance.now() - t);
    if (r.ok === false) {
      log(`ERR   ${label} (${ms} ms, ${r.errors.length} error(s))`);
      for (const e of r.errors) log(`        ${e.code}${e.nodeId ? ` ${e.nodeId}` : ''}: ${e.message}`);
      continue;
    }
    ok += 1;
    log(`OK    ${label} (${ms} ms)`);
  }
  return { total: rows.length, ok };
}

if (require.main === module) {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? 'prism',
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB ?? 'prism_db',
  });
  pool.on('connect', (client) => {
    client.query(`LOAD 'age'; SET search_path = ag_catalog, "$user", public;`).catch((): void => undefined);
  });
  compileAll(pool, (line) => console.log(line))
    .then((s) => console.log(`${s.ok}/${s.total} pathways compile`))
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
}
