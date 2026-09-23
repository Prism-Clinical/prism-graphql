/**
 * Spec §5.8 before/after record, through the deployed API (plan 05, P5-1).
 *
 * Starts anemia-in-pregnancy-v1 @ 1.4 for two sparse synthetic patients at a
 * pinned clock and prints one sorted line per node, question, flag and
 * warning. `before` runs against live main before the deploy; `after` runs
 * against the deployed pipeline and adds what only the pipeline reports.
 *
 *   node apps/pathway-service/dist/scripts/capture-resolution.js before > before.txt
 *   node apps/pathway-service/dist/scripts/capture-resolution.js after  > after.txt
 *   diff -u before.txt after.txt
 *
 * WRITES: each capture starts two sessions on the target (plan 05 🔒A / 🔒D).
 * `after` abandons its sessions; 067 purges the `before` ones.
 */

// The pathway subgraph, not the gateway: a pinned clock needs an explicit
// SYNTHETIC resolution, which needs the ADMIN role, and the gateway forwards
// no x-user-role header (trust-mode.ts parseResolutionInput / assertSyntheticAuthorized).
const ENDPOINT = process.env.GRAPHQL_URL ?? 'http://localhost:4016/graphql';
const PATHWAY_ID = process.env.CAPTURE_PATHWAY_ID ?? 'a1774566-42ce-43cc-b83c-1a5749b240e1'; // anemia-in-pregnancy-v1 @ 1.4
const AS_OF = '2026-09-10T12:00:00.000Z'; // the 2026-09-10 baseline's clock

interface Coded { code: string; system: string; display?: string }
/**
 * The PatientContextInput fields this capture sends. Declared, not inferred:
 * with noImplicitAny an inferred empty list is an implicit any[] (TS7018),
 * and ts-jest's diagnostics are off, so only tsc would notice.
 */
interface CapturePatient {
  patientId: string;
  conditionCodes: Coded[];
  medications: Coded[];
  allergies: Coded[];
  labResults: Array<{ code: string; system: string; value: number; date: string }>;
  vitalSigns: Record<string, number>;
  patientAttributes: Record<string, unknown>;
}

const WITH_HB: CapturePatient = {
  patientId: '00000000-0000-4000-a000-0000000000ff',
  conditionCodes: [{ code: 'D50.9', system: 'ICD-10' }],
  medications: [],
  allergies: [],
  labResults: [{ code: '718-7', system: 'LOINC', value: 9.4, date: '2026-08-20' }],
  vitalSigns: {},
  patientAttributes: {},
};
/** The two patients `baseline-capture.test.ts` recorded on 2026-09-10. */
export const PATIENTS: Record<'withHaemoglobin' | 'noHaemoglobin', CapturePatient> = {
  withHaemoglobin: WITH_HB,
  noHaemoglobin: { ...WITH_HB, labResults: [] },
};

interface Node {
  nodeId: string; nodeType: string; status: string; confidence: number; excludeReason: string | null;
  eligibilityStatus?: string; withheldBy?: string | null;
}
export interface StartedSession {
  id: string;
  resultHash?: string;
  includedNodes: Node[]; excludedNodes: Node[]; gatedOutNodes: Node[];
  pendingQuestions: Array<{ gateId: string; datumKey: string | null; tentative: boolean | null; tentativeBranch: string | null }>;
  redFlags: Array<{ nodeId: string; type: string }>;
  ddiWarnings: Array<{ recommendationId: string; drugName: string; category: string; severity: string }>;
}
export interface GenerationProbe {
  success: boolean;
  carePlanId: string | null;
  blockers: Array<{ scope?: string; type: string; relatedNodeIds: string[] }>;
}

const v = (x: unknown): string => (x === null || x === undefined || x === '' ? '-' : String(x));

/** The record: shared lines sorted, then the pipeline-only section when there is one. */
export function recordOf(s: StartedSession, probe?: GenerationProbe | 'skipped'): string[] {
  const nodes = [...s.includedNodes, ...s.excludedNodes, ...s.gatedOutNodes];
  const shared = [
    ...nodes.map((n) => `node ${n.nodeId} ${n.nodeType} ${n.status} conf=${n.confidence.toFixed(3)} reason=${v(n.excludeReason)}`),
    ...s.pendingQuestions.map((q) => `question ${q.gateId} datum=${v(q.datumKey)} tentative=${v(q.tentative)} branch=${v(q.tentativeBranch)}`),
    ...s.redFlags.map((f) => `flag ${f.nodeId} ${f.type}`),
    ...s.ddiWarnings.map((w) => `ddi ${w.recommendationId} ${w.drugName} ${w.category} ${w.severity}`),
  ].sort();
  const eligibility = nodes
    .filter((n) => n.eligibilityStatus !== undefined && (n.eligibilityStatus !== n.status || n.withheldBy))
    .map((n) => `eligibility ${n.nodeId} eligible=${n.eligibilityStatus} withheldBy=${v(n.withheldBy)}`)
    .sort();
  const probed = probe === undefined ? [] : probe === 'skipped'
    ? ['probe skipped (no pending question: generating would write a care plan)']
    : [
      `probe success=${probe.success} carePlan=${v(probe.carePlanId)}`,
      ...probe.blockers.map((b) => `blocker ${v(b.scope)} ${b.type} nodes=${v([...b.relatedNodeIds].sort().join(','))}`).sort(),
    ];
  const afterOnly = [...eligibility, ...probed];
  return afterOnly.length ? [...shared, '-- after only', ...afterOnly] : shared;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-role': 'ADMIN' }, body: JSON.stringify({ query, variables }) });
  const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (body.errors?.length || !body.data) throw new Error(`GraphQL: ${JSON.stringify(body.errors ?? body)}`);
  return body.data;
}

const startQuery = (after: boolean): string => `
  fragment N on ResolvedNode { nodeId nodeType status confidence excludeReason ${after ? 'eligibilityStatus withheldBy' : ''} }
  mutation Capture($pathwayId: ID!, $patientId: ID!, $ctx: PatientContextInput, $asOf: String) {
    startResolution(pathwayId: $pathwayId, patientId: $patientId, patientContext: $ctx, resolutionMode: SYNTHETIC, evaluationAsOf: $asOf) {
      id ${after ? 'resultHash' : ''}
      includedNodes { ...N } excludedNodes { ...N } gatedOutNodes { ...N }
      pendingQuestions { gateId datumKey tentative tentativeBranch }
      redFlags { nodeId type }
      ddiWarnings { recommendationId drugName category severity }
    }
  }`;

async function capture(side: 'before' | 'after'): Promise<string[]> {
  const out: string[] = [`# ${side} — pathway ${PATHWAY_ID}, evaluationAsOf ${AS_OF}, ${ENDPOINT}`];
  for (const [name, patient] of Object.entries(PATIENTS)) {
    const { startResolution: s } = await gql<{ startResolution: StartedSession }>(startQuery(side === 'after'), {
      pathwayId: PATHWAY_ID, patientId: patient.patientId, ctx: patient, asOf: AS_OF,
    });
    let probe: GenerationProbe | 'skipped' | undefined;
    if (side === 'after') {
      // P5-7: only a session that cannot generate is probed; the probe then writes no care plan.
      probe = s.pendingQuestions.length === 0 ? 'skipped' : (await gql<{ generateCarePlanFromResolution: GenerationProbe }>(
        `mutation Probe($id: ID!, $h: String!) {
          generateCarePlanFromResolution(sessionId: $id, reviewedResultHash: $h) { success carePlanId blockers { scope type relatedNodeIds } }
        }`, { id: s.id, h: s.resultHash })).generateCarePlanFromResolution;
      await gql(`mutation Done($id: ID!) { abandonSession(sessionId: $id, reason: "plan 05 capture") { id } }`, { id: s.id });
    }
    out.push('', `== ${name}`, ...recordOf(s, probe));
  }
  return out;
}

if (require.main === module) {
  const side = process.argv[2];
  if (side !== 'before' && side !== 'after') {
    console.error('usage: capture-resolution.js before|after');
    process.exitCode = 2;
  } else {
    capture(side)
      .then((lines) => console.log(lines.join('\n')))
      .catch((err) => {
        console.error(err);
        process.exitCode = 1;
      });
  }
}
