export type TemporalOperator =
  | 'includes_code' | 'equals' | 'exists'
  | 'greater_than' | 'less_than'
  | 'count_in_window' | 'trend_up' | 'trend_down' | 'delta_from_baseline';

const MEMBERSHIP = new Set<TemporalOperator>(['includes_code', 'equals', 'exists']);
const SCALAR = new Set<TemporalOperator>(['greater_than', 'less_than']);
const AGGREGATE = new Set<TemporalOperator>(['count_in_window', 'trend_up', 'trend_down', 'delta_from_baseline']);
const ALL_OPS = new Set<string>([...MEMBERSHIP, ...SCALAR, ...AGGREGATE]);

export type OperatorClass = 'membership' | 'scalar' | 'aggregate';

export function isTemporalOperator(op: string): op is TemporalOperator {
  return ALL_OPS.has(op);
}
export function operatorClass(op: TemporalOperator): OperatorClass {
  if (MEMBERSHIP.has(op)) return 'membership';
  if (SCALAR.has(op)) return 'scalar';
  if (AGGREGATE.has(op)) return 'aggregate';
  throw new Error(`unknown temporal operator: ${op}`);
}

export type GateField = 'conditions' | 'medications' | 'allergies' | 'labs' | 'vitals';
export type FactKind = 'condition' | 'medication_order' | 'allergy' | 'lab' | 'vital';

export const FIELD_TO_KIND: Record<GateField, FactKind> = {
  conditions: 'condition',
  medications: 'medication_order',
  allergies: 'allergy',
  labs: 'lab',
  vitals: 'vital',
};
export function fieldToKind(field: GateField): FactKind {
  const k = FIELD_TO_KIND[field];
  if (!k) throw new Error(`unknown gate field: ${field}`);
  return k;
}

/** Temporal-owned condition shape. Plan 04 adapts the repo's GateCondition into this. */
export interface FactSelectionCondition {
  field: GateField;
  operator: TemporalOperator;
  value: string; // membership: the code/pattern to look for; scalar/aggregate: the observation code/key
  system?: string; // optional code-system filter
}

export type UncertaintyReason =
  | 'TEMPORAL_UNKNOWN' | 'STATE_UNKNOWN' | 'VALIDITY_UNKNOWN' | 'AMBIGUOUS_LATEST';
