import { MAX_CUSTOM_HORIZON_DAYS, TemporalContextError } from './evaluation-context';
import type { EvaluationTemporalContext } from './evaluation-context';
import type { FactStore, NormalizedFact } from './fact-model';
import { boundEpochRange, instantEpoch, parseFhirDate } from './interval';

/**
 * Anchored trend windows — `window_from` (decision 2026-09-07, re-confirmed
 * 2026-09-24).
 *
 * "Is the patient responding to treatment?" is a question about the values
 * SINCE the treatment started. A fixed lookback from the evaluation clock
 * (`window_days` / `horizon`) cannot say that: 42 days is too long for a
 * patient who started iron last week (it drags in the pre-treatment values) and
 * too short for one who started four months ago. `window_from` replaces the
 * lookback's LOWER bound with the date the therapy was prescribed; the upper
 * bound stays `evaluationAsOf`.
 *
 * The selector is a therapeutic CLASS (`clinical_role`), never one product:
 * anemia offers three interchangeable oral irons, and anchoring on ferrous
 * sulfate alone would gate every gluconate or fumarate patient out.
 *
 * Resolution order — first hit wins, and there is NO silent fallback:
 *
 *   1. **CLINICIAN** — a date the clinician gave for this anchor. Prescribed is
 *      not started, and a patient already on the drug before the pathway has no
 *      in-episode order, so the clinician's word outranks every record.
 *      Stored on the session's `gateAnswers` under `anchorKeyFor(selector)`.
 *   2. **CARE_PLAN** — the EARLIEST care-plan intervention this pathway wrote
 *      for a medication of the class. Every care-plan materialization inserts a
 *      NEW plan, so latest-wins would slide the window forward at every visit
 *      and shrink it to nothing. Loaded at session creation and pinned on the
 *      evaluation context (`therapyStarts`), so retraversal and replay see the
 *      set the session was created with.
 *   3. **MEDICATION_ORDER** — the earliest dated order in the fact store whose
 *      code is one of the selector's `codes`. Orders are chart data with an
 *      interval start; this is what makes a synthetic (simulator) patient, who
 *      has no stored care plans, anchorable at all.
 *   4. **UNRESOLVED** — the condition is INDETERMINATE and the gate asks for the
 *      date (or takes its default, per `on_unresolved`). A window anchored on a
 *      guess would decide a treatment response on values nobody chose.
 */

// ─── Grammar ──────────────────────────────────────────────────────────

/** The events a window can be anchored on. One today; keyed for more. */
export const WINDOW_FROM_EVENTS = ['medication_start'] as const;
export type WindowFromEvent = (typeof WINDOW_FROM_EVENTS)[number];

/**
 * Operators a `window_from` may govern: the time-series class, and only it.
 *
 * Membership and scalar operators read "was it ever true in the window" /
 * "the latest value" — an anchored lower bound on those is a different feature
 * (and one nobody has asked for), so it is refused rather than half-supported.
 */
export const WINDOW_FROM_OPERATORS: ReadonlySet<string> = new Set([
  'count_in_window', 'trend_up', 'trend_down', 'delta_from_baseline',
]);

export interface WindowFromCode {
  system: string;
  code: string;
}

export interface WindowFromSelector {
  event: WindowFromEvent;
  /** The Medication nodes' `clinical_role` tag — the therapeutic class. */
  clinicalRole: string;
  /**
   * Chart medication codes that count as an order of this class. Optional:
   * without them the order source cannot contribute, and the anchor resolves
   * only from the care plan or the clinician.
   */
  codes: WindowFromCode[];
  /** Human name of the class for the prompt: "When did {label} start?". */
  label?: string;
  /**
   * Admit ONE pre-treatment baseline: the latest value dated within this many
   * days BEFORE the anchor day. Series operators only.
   *
   * The pre-treatment value is usually drawn before the prescription — the
   * diagnostic CBC a few days earlier — so a window opening on the start day
   * excludes exactly the value a "rise since treatment" is measured from. Only
   * the latest one is kept: a trend over several pre-treatment values would
   * re-admit the baseline drift the anchor exists to exclude.
   */
  baselineDays?: number;
}

const SELECTOR_KEYS = new Set(['event', 'clinical_role', 'codes', 'label', 'baseline_days']);

function invalid(where: string, message: string): never {
  throw new TemporalContextError(`${where}: ${message}`, 'INVALID_TEMPORAL_DEFAULTS');
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v === v.trim();
}

/**
 * Parse one authored `window_from` value.
 *
 * The ONE grammar for this key: the import validator reaches it through
 * `parseConditionOverride`, exactly as session preflight and evaluation do, so
 * a selector that imports is a selector the runtime can read (locked
 * decision #7). Unknown keys are rejected — an ignored `clinical_rol` typo
 * would resolve nothing and ask a clinician for a date on every visit.
 */
export function parseWindowFrom(raw: unknown, where: string): WindowFromSelector {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    invalid(
      where,
      `must be an object like {"event": "medication_start", "clinical_role": "<class>"} ` +
        `(got ${JSON.stringify(raw)})`,
    );
  }
  const r = raw as Record<string, unknown>;

  for (const key of Object.keys(r)) {
    if (!SELECTOR_KEYS.has(key)) {
      invalid(where, `unknown key "${key}" (allowed: ${[...SELECTOR_KEYS].join(', ')})`);
    }
  }

  if (!(WINDOW_FROM_EVENTS as readonly unknown[]).includes(r.event)) {
    invalid(
      where,
      `"event" must be one of ${WINDOW_FROM_EVENTS.join(' | ')} (got ${JSON.stringify(r.event)})`,
    );
  }

  if (!nonEmptyString(r.clinical_role)) {
    invalid(
      where,
      `"clinical_role" must be a non-empty string naming the therapeutic class ` +
        `(the Medication nodes' clinical_role), not one product (got ${JSON.stringify(r.clinical_role)})`,
    );
  }

  const codes: WindowFromCode[] = [];
  if (r.codes !== undefined) {
    if (!Array.isArray(r.codes) || r.codes.length === 0) {
      invalid(where, `"codes" must be a non-empty array of {system, code} when present`);
    }
    r.codes.forEach((c, i) => {
      const ok =
        c !== null && typeof c === 'object' && !Array.isArray(c) &&
        Object.keys(c).every((k) => k === 'system' || k === 'code' || k === 'description') &&
        nonEmptyString((c as Record<string, unknown>).system) &&
        nonEmptyString((c as Record<string, unknown>).code);
      if (!ok) {
        invalid(
          where,
          `codes[${i}] must be {"system": "<system>", "code": "<code>"} (got ${JSON.stringify(c)})`,
        );
      }
      const { system, code } = c as { system: string; code: string };
      codes.push({ system, code });
    });
  }

  const out: WindowFromSelector = {
    event: r.event as WindowFromEvent,
    clinicalRole: r.clinical_role as string,
    codes,
  };
  if (r.label !== undefined) {
    if (!nonEmptyString(r.label)) invalid(where, `"label" must be a non-empty string`);
    out.label = r.label as string;
  }
  if (r.baseline_days !== undefined) {
    const d = r.baseline_days;
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > MAX_CUSTOM_HORIZON_DAYS) {
      invalid(
        where,
        `"baseline_days" must be an integer in 1..${MAX_CUSTOM_HORIZON_DAYS} (got ${JSON.stringify(d)})`,
      );
    }
    out.baselineDays = d as number;
  }
  return out;
}

/**
 * The stable identity of an anchor: the event and the class, never the gate.
 *
 * Every gate anchored on "oral iron started" shares ONE key, so the clinician is
 * asked once and one answer re-anchors all of them. It is also the key the
 * override is stored under in `gateAnswers`; the `anchor:` prefix keeps it out
 * of the gate-id namespace `evaluateQuestion` reads.
 */
export const ANCHOR_KEY_PREFIX = 'anchor:';
export function anchorKeyFor(sel: Pick<WindowFromSelector, 'event' | 'clinicalRole'>): string {
  return `${ANCHOR_KEY_PREFIX}${sel.event}:${sel.clinicalRole}`;
}

/** What the class is called in a sentence. */
export function anchorLabelFor(sel: Pick<WindowFromSelector, 'clinicalRole' | 'label'>): string {
  return sel.label ?? sel.clinicalRole.replace(/[-_]+/g, ' ');
}

/** The question asked when the anchor cannot be resolved. */
export function anchorPromptFor(sel: Pick<WindowFromSelector, 'clinicalRole' | 'label'>): string {
  return `When did ${anchorLabelFor(sel)} start?`;
}

// ─── Dates ────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** `YYYY-MM-DD` → the UTC instant that day begins. */
export function dayStartInstant(date: string): string {
  return `${date}T00:00:00.000Z`;
}

/** The UTC calendar day an epoch falls on. */
function utcDay(ms: number): string {
  return new Date(Math.floor(ms / MS_PER_DAY) * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Why a date cannot be a window anchor for this session, or null when it can.
 *
 * Exactly `YYYY-MM-DD`: an anchor is a calendar day, and a coarser value
 * ("2026-06") would force a silent choice of which end of the month the window
 * opens on. Not after the session's `evaluationAsOf` — the SESSION clock, not
 * the wall clock, since that is the instant every window closes on: an anchor
 * after it leaves an inverted, empty window.
 *
 * Exported so the answer path rejects exactly what the evaluator would refuse.
 */
export function anchorDateProblem(date: unknown, evaluationAsOf: string): string | null {
  if (typeof date !== 'string') return 'supply dateValue as YYYY-MM-DD';
  const bound = parseFhirDate(date);
  if (!bound || bound.precision !== 'day') {
    return `dateValue must be a calendar date YYYY-MM-DD (got ${JSON.stringify(date)})`;
  }
  if (instantEpoch(dayStartInstant(date)) > instantEpoch(evaluationAsOf)) {
    return `dateValue ${date} is after this session's evaluation date (${evaluationAsOf.slice(0, 10)})`;
  }
  return null;
}

// ─── Care-plan therapy starts (pinned on the evaluation context) ─────

/**
 * One therapy start read off the patient's stored care plans: the earliest
 * `patient_care_plan_interventions` row, per clinical role, that this pathway
 * recommended. Provenance travels with it so an anchor can say where it came
 * from.
 */
export interface TherapyStartEvent {
  clinicalRole: string;
  /** `YYYY-MM-DD` — the plan's `start_date`. */
  date: string;
  source: {
    carePlanId: string;
    interventionId: string;
    pathwayId: string;
    nodeId: string;
  };
}

/**
 * Pin care-plan therapy starts onto a session's evaluation context.
 *
 * Validates every date, drops starts after `evaluationAsOf` (a plan written
 * after the session's clock did not exist at that instant), and keeps the
 * EARLIEST per clinical role. Returns the context unchanged — no key at all —
 * when nothing survives, so a pathway without `window_from`, or a patient with
 * no plans, persists exactly the context it always did.
 */
export function withTherapyStarts(
  ctx: EvaluationTemporalContext,
  events: readonly TherapyStartEvent[],
): EvaluationTemporalContext {
  const earliest = new Map<string, TherapyStartEvent>();
  for (const e of events) {
    const problem = anchorDateProblem(e.date, ctx.evaluationAsOf);
    if (problem !== null) {
      // After the clock is expected (a plan committed later than a pinned
      // simulator clock); anything else is a malformed row.
      if (typeof e.date === 'string' && parseFhirDate(e.date)?.precision === 'day') continue;
      throw new TemporalContextError(
        `care-plan therapy start for "${e.clinicalRole}": ${problem}`,
        'INVALID_RESOLUTION_INPUT',
      );
    }
    const prior = earliest.get(e.clinicalRole);
    if (!prior || e.date < prior.date) earliest.set(e.clinicalRole, e);
  }
  if (earliest.size === 0) return ctx;
  return { ...ctx, therapyStarts: [...earliest.values()] };
}

// ─── Resolution ───────────────────────────────────────────────────────

export type AnchorSource = 'CLINICIAN' | 'CARE_PLAN' | 'MEDICATION_ORDER';

export type AnchorResolution =
  | {
      status: 'RESOLVED';
      key: string;
      /** `YYYY-MM-DD`. */
      date: string;
      /** The window's lower bound: the start of `date`, UTC. */
      lowerBound: string;
      source: AnchorSource;
      /** Where the date came from, for the reason string and audit. */
      detail: string;
    }
  | { status: 'UNRESOLVED'; key: string; reason: string };

export interface AnchorInputs {
  /**
   * The session's answers. Typed structurally rather than as `GateAnswer`
   * because the temporal module must not import `types.ts` (see the note
   * there): only `dateValue` is read.
   */
  gateAnswers: ReadonlyMap<string, { dateValue?: string | null }>;
  factStore: FactStore;
  temporalContext: EvaluationTemporalContext;
}

function codeInClass(fact: NormalizedFact, codes: readonly WindowFromCode[]): boolean {
  // System compared case-insensitively: the same RxNorm arrives as RXNORM,
  // RxNorm and rxnorm across fixtures and feeds, and a class match that
  // silently failed on spelling would fall through to asking a clinician for a
  // date the chart already holds.
  const sys = fact.system.toUpperCase();
  return codes.some((c) => c.code === fact.code && c.system.toUpperCase() === sys);
}

/**
 * The earliest usable order of the class, as a UTC day.
 *
 * Usable: a medication order, code in the class, record not INVALID, and a
 * start that pins a DAY (day or instant precision) no later than the clock. A
 * month- or year-precision start cannot say which side of the window its first
 * weeks fall on, so it is skipped rather than rounded.
 *
 * EARLIEST, the same rule as the care plan and for the same reason: a refill
 * or re-order dated later would otherwise slide the window forward. The known
 * cost is a PRIOR course — an order from a previous pregnancy anchors the
 * window there. That is what the clinician override is for.
 */
function earliestOrderStart(
  sel: WindowFromSelector,
  store: FactStore,
  asOfMs: number,
): { date: string; fact: NormalizedFact } | null {
  if (sel.codes.length === 0) return null;
  let best: { ms: number; fact: NormalizedFact } | null = null;
  for (const fact of store) {
    if (fact.kind !== 'medication_order') continue;
    if (!codeInClass(fact, sel.codes)) continue;
    if (fact.recordValidity === 'INVALID') continue;
    const start = fact.interval.start;
    if (!start || (start.precision !== 'day' && start.precision !== 'instant')) continue;
    const { loMs } = boundEpochRange(start);
    if (loMs > asOfMs) continue;
    if (!best || loMs < best.ms) best = { ms: loMs, fact };
  }
  return best ? { date: utcDay(best.ms), fact: best.fact } : null;
}

/**
 * Resolve the anchor for one selector, in the documented order. Pure: every
 * input is the session's own (answers, facts, pinned context), so the same
 * session resolves the same anchor on every retraversal.
 */
export function resolveWindowAnchor(
  sel: WindowFromSelector,
  inputs: AnchorInputs,
): AnchorResolution {
  const key = anchorKeyFor(sel);
  const asOf = inputs.temporalContext.evaluationAsOf;
  const asOfMs = instantEpoch(asOf);
  const resolved = (date: string, source: AnchorSource, detail: string): AnchorResolution => ({
    status: 'RESOLVED', key, date, lowerBound: dayStartInstant(date), source, detail,
  });

  // 1. The clinician's date. Validated when it was given; a stored value that
  //    no longer parses is corruption, and anchoring on it — or quietly
  //    ignoring it in favour of a record the clinician overrode — would both
  //    decide on a date nobody chose.
  const override = inputs.gateAnswers.get(key)?.dateValue;
  if (override !== undefined && override !== null) {
    const problem = anchorDateProblem(override, asOf);
    if (problem !== null) {
      throw new TemporalContextError(`stored anchor ${key}: ${problem}`, 'INVALID_RESOLUTION_INPUT');
    }
    return resolved(override, 'CLINICIAN', 'clinician-entered start date');
  }

  // 2. The pathway's own recommendation — pinned at session creation.
  let carePlan: TherapyStartEvent | null = null;
  for (const e of inputs.temporalContext.therapyStarts ?? []) {
    if (e.clinicalRole !== sel.clinicalRole) continue;
    if (instantEpoch(dayStartInstant(e.date)) > asOfMs) continue;
    if (!carePlan || e.date < carePlan.date) carePlan = e;
  }
  if (carePlan) {
    return resolved(
      carePlan.date,
      'CARE_PLAN',
      `care plan ${carePlan.source.carePlanId} (node ${carePlan.source.nodeId})`,
    );
  }

  // 3. The chart's medication orders of the class.
  const order = earliestOrderStart(sel, inputs.factStore, asOfMs);
  if (order) {
    const what = order.fact.display ?? `${order.fact.system} ${order.fact.code}`;
    return resolved(order.date, 'MEDICATION_ORDER', `order for ${what}`);
  }

  // 4. Nothing to anchor on.
  return {
    status: 'UNRESOLVED',
    key,
    reason:
      `no start date for ${anchorLabelFor(sel)} — no clinician date, no care-plan ` +
      `recommendation for "${sel.clinicalRole}"` +
      (sel.codes.length > 0 ? ', and no dated order of the class' : ', and no order codes to match'),
  };
}
