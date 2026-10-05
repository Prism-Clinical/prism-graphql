/**
 * Where a run's plan rests on something less than a fresh, measured chart
 * value — listed for the provider before signing (Josh, 2026-10-04:
 * "Assumptions: yes, from what the engine already knows").
 *
 * Computed when asked for, from what a run already stores: the chart it was
 * given, the answers its pathways hold, and each pathway's resolved gates with
 * the conditions they evaluated. Nothing here is stored, evaluated again or
 * part of the result hash — it is a reading of the run, not an input to it.
 *
 * Five kinds, each only where the stored data supports it:
 *
 *   NOT_AVAILABLE       the provider answered "Not available" to a data
 *                       request, and a gate that needed it then took the
 *                       pathway's default.
 *   ESTIMATED_VALUE     the newest value of a lab is an ESTIMATE from its
 *                       equivalent measure (a hemoglobin from a hematocrit),
 *                       and gates that ran read that lab.
 *   OLDER_THAN_RECHECK  the pathway's own "none in the last <horizon>" gate
 *                       passed for a lab that IS on file — so every gate that
 *                       read it used a value older than the pathway's limit.
 *   VOUCHED_MEDICATION  a chart medication could not be identified and the
 *                       provider said it counts as the class a gate asked for.
 *   UNDATED_VALUE       a lab value the provider entered with no draw date,
 *                       which the run dated at the visit.
 *
 * One assumption is one THING assumed, however many gates it touched: an
 * estimated hemoglobin that decided three gates is one entry naming three.
 */

import { normalizedKey } from '../medications/safety-reference';
import { canDeriveFrom, convertLabValue, equivalenceGroupOf, labDatumKey, labMeasureFor } from './lab-equivalents';
import { MEDICATION_CLASS_KEY_PREFIX, medicationClassLabel } from './medication-classes';
import { declinedKeyFor, gateConditionLeaves } from './types';
import type { GateCondition } from './types';
import { anchorAskFor, askFor, pregnancyAskFor } from './unresolved-prompt';

export type AssumptionKind =
  | 'NOT_AVAILABLE'
  | 'ESTIMATED_VALUE'
  | 'OLDER_THAN_RECHECK'
  | 'VOUCHED_MEDICATION'
  | 'UNDATED_VALUE';

export interface RunAssumption {
  /** Stable for the thing assumed: `<pathwayId>|<kind>|<datum>`. What a client keys an acknowledgement by. */
  key: string;
  kind: AssumptionKind;
  pathwayId: string;
  /** The per-pathway session — where an anchor date is sent to reopen it. */
  sessionId: string;
  /** The datum, as the engine keys it (`LOINC:718-7`, `anchor:…`, `patient.…`, `medclass:…`). */
  datumKey: string;
  /** One or two plain sentences: what was assumed, with the figures the run holds. The gates are named in `gateTitles`, not here. */
  statement: string;
  /** The gates of `pathwayId` that ran on the assumption. A plan line citing one of them rests on it. */
  gateIds: string[];
  gateTitles: string[];
  /**
   * How the missing thing can be supplied. ANCHOR_DATE: a treatment start date,
   * sent as `dateValue` to `anchorGateId` on `sessionId` (the one answer the
   * API takes with nothing pending). CHART: only by changing the chart.
   */
  supply: 'ANCHOR_DATE' | 'CHART';
  anchorGateId: string | null;
}

/** A stored node of a pathway's resolution state — the fields read here. */
interface StoredNode {
  nodeId?: string;
  nodeType?: string;
  title?: string;
  status?: string;
  excludeReason?: string | null;
  indeterminate?: boolean | null;
  dataUnavailable?: boolean | null;
  properties?: Record<string, unknown> | null;
}

export interface AssumptionChild {
  sessionId: string;
  pathwayId: string;
  gateAnswers: Record<string, { notAvailable?: boolean; booleanValue?: boolean } | null | undefined>;
  resolutionState: Record<string, StoredNode | null | undefined>;
}

interface ChartLab {
  code: string;
  system?: string;
  value?: unknown;
  unit?: string;
  date?: string;
  providerAsserted?: boolean;
}

interface ChartContext {
  labResults?: ChartLab[] | null;
  medications?: Array<{ code?: string; system?: string; display?: string; name?: string; text?: string }> | null;
}

export interface AssumptionRun {
  /** The chart the run started from. */
  initialContext: ChartContext | null | undefined;
  /** Everything added during the encounter — values the provider entered among it. */
  additionalContext: ChartContext | null | undefined;
  children: AssumptionChild[];
}

// ─── Gates ────────────────────────────────────────────────────────────

interface Gate {
  id: string;
  title: string;
  status: string;
  node: StoredNode;
  leaves: GateCondition[];
}

/**
 * The gates of one pathway that RAN and decided. A gate closed by a gate above
 * it never evaluated its condition (its reason is the cascade's "Gated out by
 * …"), and a gate still waiting has decided nothing: neither rests on anything.
 */
function decidedGates(child: AssumptionChild): Gate[] {
  const out: Gate[] = [];
  for (const [id, node] of Object.entries(child.resolutionState ?? {})) {
    if (!node || node.nodeType !== 'Gate') continue;
    if (node.status !== 'INCLUDED' && node.status !== 'GATED_OUT') continue;
    if ((node.excludeReason ?? '').startsWith('Gated out by ')) continue;
    out.push({
      id: node.nodeId ?? id,
      title: String(node.title ?? node.properties?.title ?? id),
      status: node.status,
      node,
      leaves: gateConditionLeaves(node.properties) as GateCondition[],
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const upper = (s: unknown): string => String(s ?? '').toUpperCase();

const isLabLeaf = (c: GateCondition): c is GateCondition & { field: string; value: string; system?: string } =>
  (c as { field?: unknown }).field === 'labs' && typeof (c as { value?: unknown }).value === 'string';

const readsLab = (g: Gate, code: string, system: string): boolean =>
  g.leaves.some((c) => isLabLeaf(c) && c.value === code && upper(c.system ?? 'LOINC') === upper(system));

/** Every datum key a gate's conditions could have asked the provider for, with the question's wording. */
function asksOf(g: Gate): Array<{ datumKey: string; prompt: string; anchor: boolean; fixed: boolean }> {
  const out: Array<{ datumKey: string; prompt: string; anchor: boolean; fixed: boolean }> = [];
  for (const c of g.leaves) {
    try {
      const anchor = anchorAskFor(c);
      if (anchor) out.push({ datumKey: anchor.datumKey, prompt: anchor.prompt, anchor: true, fixed: true });
      if ((c as { horizon?: unknown }).horizon === 'PREGNANCY') {
        const ga = pregnancyAskFor();
        out.push({ datumKey: ga.datumKey, prompt: ga.prompt, anchor: false, fixed: true });
      }
      const ask = askFor(c);
      if (ask) out.push({ datumKey: ask.datumKey, prompt: ask.prompt, anchor: false, fixed: ask.fixedPrompt === true });
      // A series one value short asks for the lab under the same group key; `askFor` refuses aggregates.
      else if (isLabLeaf(c)) {
        const display = labMeasureFor(c.value, c.system)?.display ?? `${c.system ?? 'LOINC'} ${c.value}`;
        out.push({ datumKey: labDatumKey(c.value, c.system ?? 'LOINC'), prompt: `${display} — a result?`, anchor: false, fixed: true });
      }
    } catch {
      // A stored condition the current builders refuse: it names no datum here.
    }
  }
  return out;
}

const names = (gates: Gate[]): { gateIds: string[]; gateTitles: string[] } => ({
  gateIds: gates.map((g) => g.id),
  gateTitles: gates.map((g) => g.title),
});

// ─── Labs ─────────────────────────────────────────────────────────────

const dayOf = (date: string | undefined): string | undefined =>
  typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : undefined;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const withUnit = (value: number, unit: string): string => (unit === '%' ? `${value}%` : unit ? `${value} ${unit}` : String(value));

interface LabValue {
  value: number;
  day: string | undefined;
  asserted: boolean;
  /** Set on an estimate: the measured value it was converted from. */
  from?: { display: string; value: number; unit: string };
}

/**
 * Every value the engine has for one lab: the measured ones, and the estimates
 * from its equivalent measures. The rule for when an estimate exists is the
 * fact assembler's (`deriveEquivalentLabs`): the source is in its registered
 * unit, and it can be ordered against every measured value of the target — not
 * the same day, neither undated — unless it is the provider's own answer.
 */
function valuesOf(labs: ChartLab[], code: string, system: string): LabValue[] {
  const same = (l: ChartLab, c: string, s: string) => l.code === c && upper(l.system ?? 'LOINC') === upper(s);
  const measured = labs.filter((l) => same(l, code, system) && isNumber(l.value));
  const out: LabValue[] = measured.map((l) => ({ value: l.value as number, day: dayOf(l.date), asserted: l.providerAsserted === true }));
  const [, ...others] = equivalenceGroupOf(code, system) ?? [];
  for (const other of others) {
    for (const source of labs.filter((l) => same(l, other.code, other.system) && isNumber(l.value))) {
      const value = source.value as number;
      if (!canDeriveFrom({ code: source.code, system: source.system, value, unit: source.unit })) continue;
      const asserted = source.providerAsserted === true;
      const sourceDay = dayOf(source.date);
      const unorderable = measured.some((m) => sourceDay === undefined || dayOf(m.date) === undefined || dayOf(m.date) === sourceDay);
      if (unorderable && !asserted) continue;
      const estimate = convertLabValue(value, source, { code, system });
      if (estimate === null) continue;
      out.push({ value: estimate, day: sourceDay, asserted, from: { display: other.display, value, unit: source.unit || other.unit } });
    }
  }
  return out;
}

/** The value the engine's newest-value rule reads: the provider's answer, else the latest dated. Null when they cannot be ordered. */
function newestOf(values: LabValue[]): LabValue | null {
  if (values.length === 0) return null;
  const asserted = values.filter((v) => v.asserted);
  const pool = asserted.length > 0 ? asserted : values;
  if (pool.length === 1) return pool[0];
  if (pool.some((v) => v.day === undefined)) return null;
  const sorted = [...pool].sort((a, b) => (a.day! < b.day! ? 1 : a.day! > b.day! ? -1 : 0));
  // Two values on the newest day: a measured one stands over an estimate; otherwise unordered.
  const top = sorted.filter((v) => v.day === sorted[0].day);
  if (top.length === 1) return top[0];
  const measuredTop = top.filter((v) => !v.from);
  return measuredTop.length === 1 ? measuredTop[0] : null;
}

/** The lab codes a pathway's decided gates read, each once, with the name its gates give it. */
function labsRead(gates: Gate[]): Array<{ code: string; system: string; display: string }> {
  const seen = new Map<string, { code: string; system: string; display: string }>();
  for (const g of gates) {
    for (const c of g.leaves) {
      if (!isLabLeaf(c)) continue;
      const system = c.system ?? 'LOINC';
      const key = `${upper(system)}:${c.value}`;
      if (seen.has(key)) continue;
      const authored = typeof (c as { display?: unknown }).display === 'string' ? ((c as { display?: string }).display as string).trim() : '';
      seen.set(key, { code: c.value, system, display: labMeasureFor(c.value, system)?.display ?? (authored || `${system} ${c.value}`) });
    }
  }
  return [...seen.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
}

// ─── The five kinds ───────────────────────────────────────────────────

function estimated(child: AssumptionChild, gates: Gate[], labs: ChartLab[]): RunAssumption[] {
  const out: RunAssumption[] = [];
  for (const lab of labsRead(gates)) {
    const newest = newestOf(valuesOf(labs, lab.code, lab.system));
    if (!newest?.from) continue;
    const reading = gates.filter((g) => readsLab(g, lab.code, lab.system));
    const unit = labMeasureFor(lab.code, lab.system)?.unit ?? '';
    out.push({
      key: `${child.pathwayId}|ESTIMATED_VALUE|${upper(lab.system)}:${lab.code}`,
      kind: 'ESTIMATED_VALUE',
      pathwayId: child.pathwayId,
      sessionId: child.sessionId,
      datumKey: `${upper(lab.system)}:${lab.code}`,
      statement:
        `${lab.display} was not measured: ${withUnit(newest.value, unit)} is an estimate from ` +
        `${newest.from.display.toLowerCase()} ${withUnit(newest.from.value, newest.from.unit)}` +
        `${newest.day ? `, dated ${newest.day}` : ''}.`,
      ...names(reading),
      supply: 'CHART',
      anchorGateId: null,
    });
  }
  return out;
}

/**
 * The pathway's own recheck rule: a gate whose whole condition is "this lab is
 * NOT on file within <horizon>", and which PASSED. Nothing is inferred about
 * what the horizon is — the gate's title says it, in the author's words. It is
 * an assumption only when the lab IS on file (older), and another gate read it.
 */
function olderThanRecheck(child: AssumptionChild, gates: Gate[], labs: ChartLab[]): RunAssumption[] {
  const out: RunAssumption[] = [];
  const seen = new Set<string>();
  for (const rule of gates) {
    if (rule.status !== 'INCLUDED') continue;
    const props = rule.node.properties ?? {};
    const c = props.condition as (GateCondition & { horizon?: unknown; operator?: unknown }) | null | undefined;
    // A single condition only: inside a compound, the gate passing says nothing certain about this one leaf.
    if (!c || Array.isArray(props.conditions) || !isLabLeaf(c) || c.operator !== 'not_includes_code') continue;
    const horizon = upper(c.horizon);
    if (!horizon || horizon === 'LIFETIME') continue;
    const system = c.system ?? 'LOINC';
    const key = `${child.pathwayId}|OLDER_THAN_RECHECK|${upper(system)}:${c.value}`;
    if (seen.has(key)) continue;
    const newest = newestOf(valuesOf(labs, c.value, system));
    if (!newest) continue;
    const reading = gates.filter((g) => g.id !== rule.id && readsLab(g, c.value, system));
    if (reading.length === 0) continue;
    seen.add(key);
    const display = labMeasureFor(c.value, system)?.display ?? `${system} ${c.value}`;
    const unit = labMeasureFor(c.value, system)?.unit ?? '';
    out.push({
      key,
      kind: 'OLDER_THAN_RECHECK',
      pathwayId: child.pathwayId,
      sessionId: child.sessionId,
      datumKey: `${upper(system)}:${c.value}`,
      statement:
        `The pathway's own recheck rule passed — “${rule.title}”. The newest ${display.toLowerCase()} on file is ` +
        `${withUnit(newest.value, unit)}${newest.from ? ' (an estimate)' : ''}${newest.day ? ` from ${newest.day}` : ', undated'}, ` +
        `and that older value is what the rest of this problem read.`,
      ...names(reading),
      supply: 'CHART',
      anchorGateId: null,
    });
  }
  return out;
}

/** A medication-class leaf: the class code, and the key prefix of every entry's question about it. */
function classLeaves(gates: Gate[]): Array<{ gate: Gate; prefix: string; label: string }> {
  const out: Array<{ gate: Gate; prefix: string; label: string }> = [];
  for (const gate of gates) {
    for (const c of gate.leaves) {
      const leaf = c as { field?: unknown; value?: unknown; system?: unknown; display?: string };
      if (leaf.field !== 'medications' || typeof leaf.value !== 'string' || typeof leaf.system !== 'string') continue;
      out.push({
        gate,
        prefix: `${MEDICATION_CLASS_KEY_PREFIX}${leaf.system}:${leaf.value}:`,
        label: medicationClassLabel({ system: leaf.system, value: leaf.value, display: leaf.display }),
      });
    }
  }
  return out;
}

/** The chart's own name for a medication entry, from the entry half of a class key. */
function entryLabel(entryKey: string, contexts: ChartContext[]): string {
  for (const ctx of contexts) {
    for (const m of ctx.medications ?? []) {
      const text = m.display ?? m.name ?? m.text ?? m.code ?? '';
      if (normalizedKey({ text, system: m.system, code: m.code }) === entryKey) return text;
    }
  }
  // Not found as stored (an entry added later, a key built from another field): the key's own text.
  return entryKey.split('|')[0] || entryKey;
}

function vouched(child: AssumptionChild, gates: Gate[], contexts: ChartContext[]): RunAssumption[] {
  const leaves = classLeaves(gates);
  const out: RunAssumption[] = [];
  for (const [key, answer] of Object.entries(child.gateAnswers ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!key.startsWith(MEDICATION_CLASS_KEY_PREFIX) || answer?.booleanValue !== true) continue;
    const mine = leaves.filter((l) => key.startsWith(l.prefix));
    if (mine.length === 0) continue;
    const reading = [...new Map(mine.map((l) => [l.gate.id, l.gate])).values()];
    out.push({
      key: `${child.pathwayId}|VOUCHED_MEDICATION|${key}`,
      kind: 'VOUCHED_MEDICATION',
      pathwayId: child.pathwayId,
      sessionId: child.sessionId,
      datumKey: key,
      statement:
        `“${entryLabel(key.slice(mine[0].prefix.length), contexts)}” on the medication list could not be identified. ` +
        `You said it counts as ${mine[0].label}.`,
      ...names(reading),
      supply: 'CHART',
      anchorGateId: null,
    });
  }
  return out;
}

/**
 * "Not available": only while a gate that needed the datum is still deciding
 * WITHOUT it — it ran, could not answer (`indeterminate` / `dataUnavailable`),
 * and took its default. Once the value reaches the chart those gates decide as
 * usual and the old answer is no longer something the plan rests on.
 */
function notAvailable(child: AssumptionChild, gates: Gate[], contexts: ChartContext[]): RunAssumption[] {
  const out: RunAssumption[] = [];
  const undecided = gates.filter((g) => g.node.indeterminate === true || g.node.dataUnavailable === true);
  const classes = classLeaves(undecided);
  for (const [stored, answer] of Object.entries(child.gateAnswers ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const prefix = declinedKeyFor('');
    if (!stored.startsWith(prefix) || answer?.notAvailable !== true) continue;
    const datumKey = stored.slice(prefix.length);

    let reading: Gate[] = [];
    let question = '';
    let anchorGateId: string | null = null;
    if (datumKey.startsWith(MEDICATION_CLASS_KEY_PREFIX)) {
      const mine = classes.filter((l) => datumKey.startsWith(l.prefix));
      if (mine.length === 0) continue;
      reading = [...new Map(mine.map((l) => [l.gate.id, l.gate])).values()];
      question = `Does “${entryLabel(datumKey.slice(mine[0].prefix.length), contexts)}” count as ${mine[0].label}?`;
    } else {
      for (const g of undecided) {
        const ask = asksOf(g).find((a) => a.datumKey === datumKey);
        if (!ask) continue;
        reading.push(g);
        // What the provider was asked: the gate's own prompt, unless the engine's wording replaced it.
        const authored = typeof g.node.properties?.prompt === 'string' ? (g.node.properties.prompt as string).trim() : '';
        if (!question) question = ask.fixed || !authored ? ask.prompt : authored;
        if (ask.anchor && !anchorGateId) anchorGateId = g.id;
      }
      if (reading.length === 0) continue;
    }
    // The pathway's default, as it fell: a gate that passed went ahead, one that closed held its branch back.
    const passed = reading.filter((g) => g.status === 'INCLUDED').length;
    const closed = reading.length - passed;
    const fell = [passed > 0 ? `${passed} passed` : null, closed > 0 ? `${closed} closed` : null].filter(Boolean).join(' and ');
    out.push({
      key: `${child.pathwayId}|NOT_AVAILABLE|${datumKey}`,
      kind: 'NOT_AVAILABLE',
      pathwayId: child.pathwayId,
      sessionId: child.sessionId,
      datumKey,
      statement:
        `You answered “Not available” to: ${question} ` +
        `${reading.length === 1 ? 'The gate that needed it' : `The ${reading.length} gates that needed it`} took the pathway's default (${fell}).`,
      ...names(reading),
      supply: anchorGateId ? 'ANCHOR_DATE' : 'CHART',
      anchorGateId,
    });
  }
  return out;
}

/** A value the provider entered without a draw date: the run dated it at the visit. */
function undated(child: AssumptionChild, gates: Gate[], additional: ChartContext): RunAssumption[] {
  const out: RunAssumption[] = [];
  for (const lab of additional.labResults ?? []) {
    if (lab.providerAsserted !== true || !isNumber(lab.value)) continue;
    const system = lab.system ?? 'LOINC';
    // The gates that read it — as itself, or through an equivalent measure it estimates.
    const group = equivalenceGroupOf(lab.code, system) ?? [{ code: lab.code, system, display: '', unit: '' }];
    const reading = gates.filter((g) => group.some((m) => readsLab(g, m.code, m.system)));
    if (reading.length === 0) continue;
    const measure = labMeasureFor(lab.code, system);
    const display = measure?.display ?? `${system} ${lab.code}`;
    out.push({
      key: `${child.pathwayId}|UNDATED_VALUE|${upper(system)}:${lab.code}`,
      kind: 'UNDATED_VALUE',
      pathwayId: child.pathwayId,
      sessionId: child.sessionId,
      datumKey: `${upper(system)}:${lab.code}`,
      statement:
        `${display} ${withUnit(lab.value, lab.unit || measure?.unit || '')} was entered by you with no draw date, ` +
        `so it is dated at the visit${dayOf(lab.date) ? ` (${dayOf(lab.date)})` : ''} and read as the newest.`,
      ...names(reading),
      supply: 'CHART',
      anchorGateId: null,
    });
  }
  return out;
}

/** Every assumption a run's plan rests on, pathway by pathway, in a stable order. */
export function runAssumptions(run: AssumptionRun): RunAssumption[] {
  const initial = run.initialContext ?? {};
  const additional = run.additionalContext ?? {};
  const contexts = [initial, additional];
  const labs = [...(initial.labResults ?? []), ...(additional.labResults ?? [])];
  const out: RunAssumption[] = [];
  for (const child of run.children) {
    const gates = decidedGates(child);
    out.push(
      ...notAvailable(child, gates, contexts),
      ...estimated(child, gates, labs),
      ...olderThanRecheck(child, gates, labs),
      ...vouched(child, gates, contexts),
      ...undated(child, gates, additional),
    );
  }
  // One entry per thing assumed: a repeated key (the same lab entered twice) keeps its first.
  return [...new Map(out.map((a) => [a.key, a] as const).reverse()).values()].reverse();
}
