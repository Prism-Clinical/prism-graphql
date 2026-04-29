import type { PathwayNodeType } from '@/types';

export type FieldType = 'text' | 'number' | 'textarea' | 'select' | 'checkbox';

export interface PropertyField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
}

const MEDICATION_ROLES = [
  { value: 'first_line', label: 'First-line' },
  { value: 'second_line', label: 'Second-line' },
  { value: 'alternative', label: 'Alternative' },
  { value: 'preferred', label: 'Preferred' },
  { value: 'acceptable', label: 'Acceptable' },
  { value: 'avoid', label: 'Avoid' },
  { value: 'contraindicated', label: 'Contraindicated' },
];

const EVIDENCE_LEVELS = [
  { value: 'Level A', label: 'Level A' },
  { value: 'Level B', label: 'Level B' },
  { value: 'Level C', label: 'Level C' },
  { value: 'Expert Consensus', label: 'Expert Consensus' },
];

const CODE_SYSTEMS = [
  { value: 'ICD-10', label: 'ICD-10' },
  { value: 'SNOMED', label: 'SNOMED' },
  { value: 'RXNORM', label: 'RxNorm' },
  { value: 'LOINC', label: 'LOINC' },
  { value: 'CPT', label: 'CPT' },
];

export const PROPERTY_FIELDS: Record<PathwayNodeType, PropertyField[]> = {
  Stage: [
    { key: 'stage_number', label: 'Stage Number', type: 'number', required: true },
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g., Initial Assessment' },
    { key: 'description', label: 'Description', type: 'textarea', required: false },
  ],
  Step: [
    { key: 'stage_number', label: 'Stage Number', type: 'number', required: true },
    { key: 'step_number', label: 'Step Number', type: 'number', required: true },
    { key: 'display_number', label: 'Display Number', type: 'text', required: true, placeholder: 'e.g., 1.1' },
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g., Obtain Surgical History' },
    { key: 'description', label: 'Description', type: 'textarea', required: false },
  ],
  DecisionPoint: [
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g., Delivery Method Decision' },
    { key: 'auto_resolve_eligible', label: 'Auto-resolve eligible', type: 'checkbox', required: false },
  ],
  Criterion: [
    { key: 'description', label: 'Description', type: 'textarea', required: true, placeholder: 'e.g., Single prior low-transverse cesarean' },
    { key: 'code_system', label: 'Code System', type: 'select', required: false, options: CODE_SYSTEMS },
    { key: 'code_value', label: 'Code Value', type: 'text', required: false, placeholder: 'e.g., O34.211' },
    { key: 'base_rate', label: 'Base Rate', type: 'number', required: false },
    { key: 'is_critical', label: 'Critical criterion', type: 'checkbox', required: false },
  ],
  Medication: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g., Amoxicillin' },
    { key: 'role', label: 'Role', type: 'select', required: true, options: MEDICATION_ROLES },
    { key: 'dose', label: 'Dose', type: 'text', required: false, placeholder: 'e.g., 500mg' },
    { key: 'route', label: 'Route', type: 'text', required: false, placeholder: 'e.g., Oral, IV' },
    { key: 'frequency', label: 'Frequency', type: 'text', required: false, placeholder: 'e.g., TID x 10 days' },
  ],
  LabTest: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g., Complete Blood Count' },
    { key: 'code_system', label: 'Code System', type: 'select', required: false, options: CODE_SYSTEMS },
    { key: 'code_value', label: 'Code Value', type: 'text', required: false },
  ],
  Procedure: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g., Cesarean Delivery' },
    { key: 'code_system', label: 'Code System', type: 'select', required: false, options: CODE_SYSTEMS },
    { key: 'code_value', label: 'Code Value', type: 'text', required: false },
  ],
  CodeEntry: [
    { key: 'system', label: 'Code System', type: 'select', required: true, options: CODE_SYSTEMS },
    { key: 'code', label: 'Code', type: 'text', required: true, placeholder: 'e.g., J02.0' },
    { key: 'description', label: 'Description', type: 'text', required: false },
  ],
  EvidenceCitation: [
    { key: 'reference_number', label: 'Reference #', type: 'number', required: true },
    { key: 'title', label: 'Title', type: 'text', required: true, placeholder: 'e.g., ACOG Practice Bulletin' },
    { key: 'evidence_level', label: 'Evidence Level', type: 'select', required: true, options: EVIDENCE_LEVELS },
    { key: 'source', label: 'Source', type: 'text', required: false, placeholder: 'e.g., Journal name' },
    { key: 'year', label: 'Year', type: 'number', required: false },
  ],
  QualityMetric: [
    { key: 'name', label: 'Name', type: 'text', required: true, placeholder: 'e.g., VBAC Success Rate' },
    { key: 'measure', label: 'Measure', type: 'textarea', required: true, placeholder: 'What this metric measures' },
    { key: 'target', label: 'Target', type: 'text', required: false, placeholder: 'e.g., >= 60%' },
  ],
  Schedule: [
    { key: 'interval', label: 'Interval', type: 'text', required: true, placeholder: 'e.g., Every 15 minutes' },
    { key: 'description', label: 'Description', type: 'textarea', required: true },
    { key: 'duration', label: 'Duration', type: 'text', required: false, placeholder: 'e.g., Throughout active labor' },
  ],
};
