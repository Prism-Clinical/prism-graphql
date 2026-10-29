/**
 * EXPERIMENTAL, NONCLINICAL. Per-record S5 criterion evaluation (evidence-query contract §3.5).
 *
 * Evaluates a compiled query's `establishes` and `refutes` over ONE possibility of an S4 result,
 * reading its exact payload only through the evidence handoff (§2.8). The criteria are the
 * compiler's `eq(c.<field>, <Enum>.<value>)` form, the only criterion form I1 accepts; `all`, `any`,
 * `not`, `call` and nested holes are compile errors in criterion position, and a whole-criterion hole
 * exists only in a PreviewPackage, which S5 rejects, so no other tree reaches here.
 * It classifies nothing, selects nothing and decides no materiality. Pure; detached, deep-frozen.
 */
import { queryContract, selectionQuery } from '../bound';
import { ENUMS, detach } from '../compile/compile';
import type { EnumCriterion, ExplicitAssertionContract } from '../compile/types';
import type { JsonObject } from '../s1/resolve';
import type { JsonValue } from '../s1/types';
import { isSelectionResult, selectionEvidence } from '../s4/select';
import type { PossibleSelection } from '../s4/types';
import type { CriteriaInput, CriteriaResult, CriterionName, CriterionResult, CriterionStep, CriterionValue } from './types';

/** Invalid API input. Never used for patient-evidence uncertainty, and never a criterion value. */
export class CriteriaConfigurationError extends Error {}

const INPUT_FIELDS = ['package', 'query', 's4', 'possibility'];

/** Contract §3.4 for one `eq(c.f, Enum.v)`: exact comparison, no normalization or default. */
function evaluate(name: CriterionName, c: EnumCriterion, payload: Readonly<JsonObject>): CriterionResult {
  const fieldStep = (read: Extract<CriterionStep, { form: 'field' }>['read']): CriterionStep => ({ form: 'field', source: `${c.location}/eq/0`, path: `c.${c.field}`, read });
  const enumStep: CriterionStep = { form: 'enum', source: `${c.location}/eq/1`, value: `${c.enumType}.${c.value}` };
  let read: Extract<CriterionStep, { form: 'field' }>['read'];
  let result: CriterionValue;
  if (!Object.prototype.hasOwnProperty.call(payload, c.field)) {
    read = { status: 'Absent' };
    result = { value: 'Unknown', findings: [{ cause: 'Missing', origin: 'record', reason: `FieldAbsent:${c.field}` }] };
  } else {
    const v = payload[c.field] as JsonValue;
    // A value that is not exactly a declared code (null, another type, an undeclared or differently
    // cased string) is malformed: its true value is unknown, so it is never "not equal".
    if (typeof v === 'string' && ENUMS.get(c.enumType)!.includes(v)) {
      read = { status: 'Present', value: v };
      result = { value: v === c.value ? 'True' : 'False' };
    } else {
      read = { status: 'Malformed', value: v };
      result = { value: 'Unknown', findings: [{ cause: 'Invalid', origin: 'record', reason: `FieldMalformed:${c.field}` }] };
    }
  }
  return { criterion: name, source: c.location, result, trace: [fieldStep(read), enumStep, { form: 'eq', source: c.location, result }] };
}

/**
 * INTERNAL, shared by every S5 entry point: exactly `fields`, an authentic CompiledPackage and
 * EvidenceQuery, and an S4 result bound to that exact package object and query ID (§3.5).
 */
export function boundContract(input: { readonly package: unknown; readonly query: unknown; readonly s4: unknown }, fields: readonly string[]): ExplicitAssertionContract {
  const fail = (m: string): never => {
    throw new CriteriaConfigurationError(m);
  };
  if (input === null || typeof input !== 'object') fail('input must be an object');
  const keys = Object.keys(input);
  const extra = keys.filter((k) => !fields.includes(k));
  // In particular a payload, snapshot or S1–S3 result: evidence comes only from the S4 handoff.
  if (extra.length > 0) fail(`unexpected input field(s) ${extra.join(', ')}`);
  const contract = queryContract(input.package, input.query, fail);
  if (!isSelectionResult(input.s4)) fail('s4 must be an S4 result produced by experimentalSelectForQuery in this process');
  // Exact package object and query ID (§3.5): a matching package ID or value-set pin is no proof.
  const bound = selectionQuery(input.s4);
  if (!bound) fail('s4 is not bound to a query: only experimentalSelectForQuery results are evaluated');
  if (bound!.package !== input.package) fail('s4 was selected for another compiled package');
  if (bound!.query !== input.query) fail(`s4 was selected for query ${JSON.stringify(bound!.query)}, not ${JSON.stringify(input.query)}`);
  return contract;
}

export function evaluateCriteria(input: CriteriaInput): CriteriaResult {
  const contract = boundContract(input, INPUT_FIELDS);
  const { s4, possibility } = input;
  // Ownership by identity: a copy, a fabrication or another result's possibility is rejected.
  const owner = s4.keys.find((k) => k.possibilities.includes(possibility));
  if (!owner) throw new CriteriaConfigurationError('possibility is not a possibility of this S4 result');
  const common = { experimental: 'nonclinical-s5-criteria-v0', stage: 'S5', scope: 'one-possibility-criteria', packageId: input.package.packageId, query: input.query, key: owner.key } as const;
  const p = possibility as PossibleSelection;
  if (p.kind !== 'node') return detach({ ...common, outcome: 'NotEvaluated', reason: p.kind === 'excluded' ? 'ExcludedMarker' : 'UnknownMarker' });
  if (p.candidacy === 'OutOfDomain') return detach({ ...common, outcome: 'NotEvaluated', reason: 'OutOfDomain', node: p.node });
  // A definite mismatch can never supply Supporting or Refuting, whatever else is unresolved (§2.8).
  if (p.selection.disposition === 'NotSelected' && p.selection.blockers.includes('Inadmissible')) {
    return detach({ ...common, outcome: 'NotEvaluated', reason: 'Inadmissible', node: p.node });
  }
  // Selected, or blocked only by history, candidacy or admissibility uncertainty.
  const payload = selectionEvidence(s4, p);
  return detach({
    ...common,
    outcome: 'Evaluated',
    node: p.node,
    disposition: p.selection,
    establishes: evaluate('establishes', contract.establishes, payload),
    refutes: evaluate('refutes', contract.refutes, payload),
  });
}
