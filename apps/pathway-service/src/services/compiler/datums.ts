// apps/pathway-service/src/services/compiler/datums.ts
import { KNOWN_PATIENT_ATTRIBUTES } from '../resolution/attribute-vocabulary';
import { conditionReadsGestationalAge } from '../resolution/temporal/condition-adapter';
import { PREGNANCY_HORIZON_ATTRIBUTE } from '../resolution/temporal/evaluation-context';
import type { AttributeCodeMap } from '../resolution/types';
import type { CompileError, DatumKey, DatumSpec } from './model';

type ValueType = DatumSpec['valueType'];
export interface DatumRegistry { types: Map<DatumKey, ValueType>; conflicts: Map<DatumKey, string> }

const NUMERIC_CODED = new Set(['greater_than', 'less_than', 'trend_up', 'trend_down', 'delta_from_baseline']);
const ORDERED_ATTRIBUTE_OPS = new Set(['greater_than', 'greater_or_equal', 'less_than', 'less_or_equal']);
const keyOfRow = (row: { namespace: string; system: string; code: string }): DatumKey =>
  `${row.namespace === 'allergy' ? 'allergy' : 'lab'}:${row.system}:${row.code}`;

/** Once per compilation. Aliases must agree on a code's type; a disagreement is kept as a conflict, never resolved by picking one. */
export function buildDatumRegistry(codeMap: AttributeCodeMap): DatumRegistry {
  const declared = new Map<DatumKey, Map<ValueType, string[]>>();
  for (const row of codeMap.values()) {
    const byType = declared.get(keyOfRow(row)) ?? new Map<ValueType, string[]>();
    byType.set(row.valueType, [...(byType.get(row.valueType) ?? []), row.attributeName].sort());
    declared.set(keyOfRow(row), byType);
  }
  const types = new Map<DatumKey, ValueType>();
  const conflicts = new Map<DatumKey, string>();
  for (const [key, byType] of declared) {
    if (byType.size === 1) { types.set(key, [...byType.keys()][0]); continue; }
    conflicts.set(key, [...byType].map(([t, names]) => names.map((n) => `${n} (${t})`)).flat().sort().join(', '));
  }
  return { types, conflicts };
}

const ofType = (v: unknown, t: ValueType) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === t);

/** Why an attribute condition's operand cannot be compared with a `t` datum, or null. No coercion. */
function operandProblem(op: string, value: unknown, t: ValueType): string | null {
  if (op === 'exists') return null;
  if (ORDERED_ATTRIBUTE_OPS.has(op)) return typeof value === 'number' && Number.isFinite(value) ? null : `${op} needs a finite number (got ${JSON.stringify(value)})`;
  if (op === 'in') return Array.isArray(value) && value.length > 0 && value.every((v) => ofType(v, t)) ? null : `in needs a non-empty list of ${t} values (got ${JSON.stringify(value)})`;
  return ofType(value, t) ? null : `${op} needs a ${t} value (got ${JSON.stringify(value)})`;
}

export function resolveDatums(
  gateId: string,
  conditions: Record<string, unknown>[],
  codeMap: AttributeCodeMap,
  registry: DatumRegistry,
  datums: Map<DatumKey, DatumSpec>,
  errors: CompileError[],
): void {
  const fail = (code: 'DATUM_TYPE' | 'PAYLOAD', message: string) => errors.push({ code, nodeId: gateId, message: `Gate "${gateId}": ${message}` });
  /** Records the read; returns the datum's type, or null when the read is invalid. */
  const add = (key: DatumKey, domain: DatumSpec['domain'], fallback: ValueType, numeric: boolean): ValueType | null => {
    const conflict = registry.conflicts.get(key);
    if (conflict) { fail('DATUM_TYPE', `${key} is declared with conflicting types by ${conflict}; fix pathway_attribute_code_map`); return null; }
    const valueType = registry.types.get(key) ?? fallback;
    if (numeric && valueType !== 'number') { fail('DATUM_TYPE', `compares ${key} numerically, but it is a ${valueType} value`); return null; }
    const d = datums.get(key);
    if (!d) datums.set(key, { key, domain, valueType, readBy: [gateId] });
    else if (!d.readBy.includes(gateId)) { d.readBy.push(gateId); d.readBy.sort(); }
    return valueType;
  };
  const checkOperand = (c: Record<string, unknown>, t: ValueType | null) => {
    if (t === null) return;
    const p = operandProblem(String(c.operator ?? ''), c.value, t);
    if (p) fail('PAYLOAD', `condition on "${String(c.attribute)}": ${p}`);
  };

  // Nested AND/OR groups contribute their LEAVES: a datum two levels down is
  // still a datum the gate reads.
  const leaves = (cs: Record<string, unknown>[]): Record<string, unknown>[] =>
    cs.flatMap((c) => (Array.isArray(c.conditions) && c.field === undefined && c.attribute === undefined
      ? leaves(c.conditions as Record<string, unknown>[])
      : [c]));
  for (const c of leaves(conditions)) {
    const op = String(c.operator ?? '');
    // `horizon: "PREGNANCY"` bounds the window by the patient's gestational
    // age, so the gate READS that attribute whatever else it reads — including
    // a membership condition, which otherwise reads no datum at all. Recorded
    // first, and independently of the chain below (which `continue`s).
    if (conditionReadsGestationalAge(c)) {
      add(`attribute:${PREGNANCY_HORIZON_ATTRIBUTE.slice('patient.'.length)}`, 'attribute', 'number', true);
    }
    if (typeof c.attribute === 'string') {
      const [ns, ...rest] = c.attribute.split('.');
      const name = rest.join('.');
      const numeric = ORDERED_ATTRIBUTE_OPS.has(op);
      if (ns === 'lab' || ns === 'allergy') {
        const row = codeMap.get(c.attribute);
        if (!row) {
          errors.push({ code: 'UNMAPPED_ATTRIBUTE', nodeId: gateId, message: `Gate "${gateId}": attribute "${c.attribute}" has no pathway_attribute_code_map row, so it cannot be read` });
          continue;
        }
        checkOperand(c, add(keyOfRow(row), ns, row.valueType, numeric));
      } else if (ns === 'vitals') {
        checkOperand(c, add(`vital:${name}`, 'vital', 'number', numeric));
      } else if (ns === 'patient') {
        const known = KNOWN_PATIENT_ATTRIBUTES.find((p) => p.name === name);
        if (!known) {
          errors.push({ code: 'UNKNOWN_PATIENT_ATTRIBUTE', nodeId: gateId, message: `Gate "${gateId}": "${c.attribute}" is not a known patient attribute (${KNOWN_PATIENT_ATTRIBUTES.map((p) => p.name).join(', ')})` });
          continue;
        }
        checkOperand(c, add(`attribute:${name}`, 'attribute', known.valueType, numeric));
      }
      // Other namespaces are rejected by validatePathwayJson (V6).
    } else if (NUMERIC_CODED.has(op) && c.field === 'labs') {
      add(`lab:${String(c.system ?? 'LOINC')}:${String(c.value)}`, 'lab', 'number', true);
    } else if (NUMERIC_CODED.has(op) && c.field === 'vitals') {
      add(`vital:${String(c.value)}`, 'vital', 'number', true);
    }
    // Membership, count_in_window, and conditions/medications/allergies: no datum (spec §5.1; review of d8711e2 #3).
  }
}
