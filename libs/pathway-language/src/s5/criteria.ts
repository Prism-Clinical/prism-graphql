/**
 * EXPERIMENTAL, NONCLINICAL. Per-record S5 criterion evaluation (evidence-query contract §3.5).
 *
 * Evaluates a compiled query's `establishes` and `refutes` over ONE possibility of an S4 result,
 * reading its exact payload only through the evidence handoff (§2.8). The criteria are the
 * compiler's `eq(c.<field>, <Enum>.<value>)` form, the only criterion form I1 accepts; `all`, `any`,
 * `not`, `call` and holes are compile errors in criterion position, so no other tree reaches here.
 * It classifies nothing, selects nothing and decides no materiality. Pure; detached, deep-frozen.
 */
import { ENUMS, compiledKind, detach } from '../compile/compile';
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

function contractOf(input: CriteriaInput): ExplicitAssertionContract {
  const fail = (m: string): never => {
    throw new CriteriaConfigurationError(m);
  };
  if (input === null || typeof input !== 'object') fail('input must be an object');
  const keys = Object.keys(input);
  const extra = keys.filter((k) => !INPUT_FIELDS.includes(k));
  // In particular a payload, snapshot or S1–S3 result: evidence comes only from the S4 handoff.
  if (extra.length > 0) fail(`unexpected input field(s) ${extra.join(', ')}`);
  const kind = compiledKind(input.package);
  // Holes are authoring state, not patient uncertainty: preview is outside this slice (§6.1).
  if (kind === 'PreviewPackage') fail('preview packages are not evaluated here; authoring holes are never Missing or False');
  if (kind !== 'CompiledPackage') fail('package must be a CompiledPackage produced by experimentalCompile in this process');
  const decl = input.package.declarations.find((d) => d.id === input.query);
  if (!decl || decl.kind !== 'EvidenceQuery') fail(`query ${JSON.stringify(input.query)} is not an EvidenceQuery of the package`);
  const contract = (decl as Extract<typeof decl, { kind: 'EvidenceQuery' }>).contract;
  if (contract.kind !== 'explicit-assertion-v0') fail(`query ${input.query} has no complete contract`); // unreachable for a CompiledPackage
  if (!isSelectionResult(input.s4)) fail('s4 must be an S4 result produced by experimentalSelect in this process');
  // Necessary, not sufficient: a match does not prove the S4 result is this query's evaluation.
  if (input.s4.valueSet !== (contract as ExplicitAssertionContract).valueSet) fail(`s4 pins ${input.s4.valueSet}, the query ${(contract as ExplicitAssertionContract).valueSet}`);
  return contract as ExplicitAssertionContract;
}

export function evaluateCriteria(input: CriteriaInput): CriteriaResult {
  const contract = contractOf(input);
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
