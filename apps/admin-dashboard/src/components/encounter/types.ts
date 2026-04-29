export type DxSource = 'verbal' | 'list' | 'manual';

export interface Diagnosis {
  id: string;
  icd: string;
  name: string;
  source: DxSource;
}

export type AttrStatus = 'pending' | 'confirmed' | 'dismissed';

export interface EncounterState {
  currentPhase: number;
  diagnoses: Diagnosis[];
  gdmAttrs: Record<number, AttrStatus>;
  gdmPlanRevealed: boolean;
  theme: 'light' | 'dark';
  dxInputValue: string;
  dxSuggestOpen: boolean;
  noteForm: 'long' | 'short';
}

export const SOURCE_LABEL: Record<DxSource, string> = {
  verbal: 'V',
  list: 'L',
  manual: 'M',
};

export const DX_SUGGESTIONS = [
  { icd: 'O14.93', name: 'Pre-eclampsia, unspecified trimester', category: 'Obstetric' },
  { icd: 'O99.013', name: 'Anemia complicating pregnancy, third trimester', category: 'Obstetric' },
  { icd: 'O26.83', name: 'Pregnancy-related peripheral neuritis', category: 'Obstetric' },
  { icd: 'R10.30', name: 'Lower abdominal pain, unspecified', category: 'Symptom' },
];

export const INITIAL_DIAGNOSES: Diagnosis[] = [
  { id: 'gdm', icd: 'O24.410', name: 'Gestational diabetes', source: 'list' },
  { id: 'chtn', icd: 'O10.012', name: 'Chronic hypertension', source: 'list' },
  { id: 'routine28', icd: 'Z34.83', name: 'Routine prenatal 28w', source: 'verbal' },
];
