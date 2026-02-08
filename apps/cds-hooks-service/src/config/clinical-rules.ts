/**
 * Clinical Rules Configuration
 *
 * Externalized clinical logic for CDS recommendations.
 * This allows clinical rules to be maintained separately from code.
 */

import { GUIDELINE_SOURCES } from '../constants';

/**
 * Action types for care plan recommendations
 */
export type ActionType = 'order' | 'referral' | 'education' | 'monitoring';

/**
 * Clinical rule for condition-based recommendations
 */
export interface ConditionRule {
  /** ICD-10 or SNOMED code prefix to match */
  codePrefix: string;
  /** Code system (icd-10, snomed) */
  codeSystem: 'icd-10' | 'snomed';
  /** Rule identifier */
  id: string;
  /** Condition category name */
  conditionName: string;
  /** Recommendation title template (can use {{conditionDisplay}}) */
  titleTemplate: string;
  /** Recommendation description template */
  descriptionTemplate: string;
  /** Priority level */
  priority: 'critical' | 'warning' | 'info';
  /** Clinical rationale */
  rationale: string;
  /** Recommended actions */
  actions: Array<{
    description: string;
    type: ActionType;
  }>;
  /** Guideline source reference */
  source: {
    label: string;
    url?: string;
  };
}

/**
 * Screening rule based on patient demographics
 */
export interface ScreeningRule {
  /** Rule identifier */
  id: string;
  /** Screening name */
  name: string;
  /** Title for the recommendation card */
  title: string;
  /** Description for the recommendation */
  description: string;
  /** Age range for applicability */
  ageRange: {
    min: number;
    max: number;
  };
  /** Optional gender requirement */
  gender?: 'male' | 'female';
  /** Priority level */
  priority: 'critical' | 'warning' | 'info';
  /** Clinical rationale */
  rationale: string;
  /** Guideline source reference */
  source: {
    label: string;
    url?: string;
  };
}

/**
 * ICD-10 based condition rules
 */
export const ICD10_CONDITION_RULES: ConditionRule[] = [
  // Diabetes mellitus (E10-E14)
  {
    codePrefix: 'E1',
    codeSystem: 'icd-10',
    id: 'diabetes-care-plan',
    conditionName: 'Diabetes',
    titleTemplate: 'Diabetes Care Plan Review Recommended',
    descriptionTemplate: 'Patient has {{conditionDisplay}}. Review care plan for A1C monitoring, foot exams, and eye exams.',
    priority: 'info',
    rationale: 'ADA guidelines recommend quarterly A1C for uncontrolled diabetes and annual foot/eye exams.',
    actions: [
      { description: 'Order A1C if not done in last 3 months', type: 'order' },
      { description: 'Schedule annual diabetic eye exam', type: 'referral' },
      { description: 'Perform diabetic foot exam', type: 'monitoring' },
    ],
    source: GUIDELINE_SOURCES.ADA,
  },

  // Hypertension (I10-I16)
  {
    codePrefix: 'I1',
    codeSystem: 'icd-10',
    id: 'hypertension-management',
    conditionName: 'Hypertension',
    titleTemplate: 'Hypertension Management Review',
    descriptionTemplate: 'Patient has {{conditionDisplay}}. Review blood pressure control and medication adherence.',
    priority: 'info',
    rationale: 'JNC guidelines recommend regular BP monitoring and lifestyle modifications.',
    actions: [
      { description: 'Review home BP logs', type: 'monitoring' },
      { description: 'Assess medication adherence', type: 'education' },
    ],
    source: GUIDELINE_SOURCES.JNC,
  },

  // Heart failure (I50)
  {
    codePrefix: 'I50',
    codeSystem: 'icd-10',
    id: 'heart-failure-care',
    conditionName: 'Heart Failure',
    titleTemplate: 'Heart Failure Care Plan Attention Needed',
    descriptionTemplate: 'Patient has {{conditionDisplay}}. Ensure guideline-directed medical therapy is optimized.',
    priority: 'warning',
    rationale: 'ACC/AHA guidelines recommend GDMT optimization including ACEi/ARB/ARNI, beta-blocker, and MRA.',
    actions: [
      { description: 'Review current GDMT medications', type: 'monitoring' },
      { description: 'Check recent BNP/proBNP levels', type: 'order' },
      { description: 'Assess fluid status and weight', type: 'monitoring' },
    ],
    source: GUIDELINE_SOURCES.ACC_AHA_HF,
  },

  // COPD (J44)
  {
    codePrefix: 'J44',
    codeSystem: 'icd-10',
    id: 'copd-care',
    conditionName: 'COPD',
    titleTemplate: 'COPD Care Plan Review',
    descriptionTemplate: 'Patient has {{conditionDisplay}}. Review inhaler technique and exacerbation history.',
    priority: 'info',
    rationale: 'GOLD guidelines recommend annual spirometry and inhaler technique assessment.',
    actions: [
      { description: 'Assess inhaler technique', type: 'education' },
      { description: 'Review vaccination status', type: 'monitoring' },
      { description: 'Evaluate for pulmonary rehabilitation referral', type: 'referral' },
    ],
    source: GUIDELINE_SOURCES.GOLD,
  },

  // Chronic kidney disease (N18)
  {
    codePrefix: 'N18',
    codeSystem: 'icd-10',
    id: 'ckd-monitoring',
    conditionName: 'CKD',
    titleTemplate: 'CKD Monitoring Needed',
    descriptionTemplate: 'Patient has {{conditionDisplay}}. Monitor kidney function and manage cardiovascular risk.',
    priority: 'warning',
    rationale: 'KDIGO guidelines recommend regular monitoring of eGFR and UACR.',
    actions: [
      { description: 'Check recent eGFR and UACR', type: 'order' },
      { description: 'Review nephrotoxic medications', type: 'monitoring' },
      { description: 'Consider nephrology referral if eGFR declining', type: 'referral' },
    ],
    source: GUIDELINE_SOURCES.KDIGO,
  },
];

/**
 * SNOMED-CT based condition rules
 */
export const SNOMED_CONDITION_RULES: ConditionRule[] = [
  // Asthma (195967001)
  {
    codePrefix: '195967001',
    codeSystem: 'snomed',
    id: 'asthma-control',
    conditionName: 'Asthma',
    titleTemplate: 'Asthma Control Assessment',
    descriptionTemplate: 'Patient has {{conditionDisplay}}. Assess asthma control and review action plan.',
    priority: 'info',
    rationale: 'GINA guidelines recommend regular assessment of asthma control.',
    actions: [
      { description: 'Review asthma action plan', type: 'education' },
      { description: 'Check rescue inhaler use frequency', type: 'monitoring' },
    ],
    source: GUIDELINE_SOURCES.GINA,
  },
];

/**
 * Age-based screening rules
 */
export const SCREENING_RULES: ScreeningRule[] = [
  // Colorectal cancer screening (45-75)
  {
    id: 'colorectal-screening',
    name: 'Colorectal Cancer Screening',
    title: 'Colorectal Cancer Screening',
    description: 'Patient is in the recommended age range for colorectal cancer screening. Review screening status.',
    ageRange: { min: 45, max: 75 },
    priority: 'info',
    rationale: 'USPSTF recommends colorectal cancer screening for adults aged 45-75.',
    source: GUIDELINE_SOURCES.USPSTF,
  },

  // Breast cancer screening (50-74, female)
  {
    id: 'breast-screening',
    name: 'Breast Cancer Screening',
    title: 'Breast Cancer Screening',
    description: 'Patient is in the recommended age range for mammography screening. Review screening status.',
    ageRange: { min: 50, max: 74 },
    gender: 'female',
    priority: 'info',
    rationale: 'USPSTF recommends biennial screening mammography for women aged 50-74.',
    source: GUIDELINE_SOURCES.USPSTF,
  },

  // Cervical cancer screening (21-65, female)
  {
    id: 'cervical-screening',
    name: 'Cervical Cancer Screening',
    title: 'Cervical Cancer Screening',
    description: 'Patient is in the recommended age range for cervical cancer screening. Review screening status.',
    ageRange: { min: 21, max: 65 },
    gender: 'female',
    priority: 'info',
    rationale: 'USPSTF recommends cervical cancer screening for women aged 21-65.',
    source: GUIDELINE_SOURCES.USPSTF,
  },

  // Lung cancer screening (50-80)
  {
    id: 'lung-screening',
    name: 'Lung Cancer Screening',
    title: 'Lung Cancer Screening Consideration',
    description: 'Patient is in the age range where lung cancer screening may be appropriate. Review smoking history.',
    ageRange: { min: 50, max: 80 },
    priority: 'info',
    rationale: 'USPSTF recommends annual low-dose CT for adults 50-80 with 20+ pack-year smoking history.',
    source: GUIDELINE_SOURCES.USPSTF,
  },

  // Abdominal aortic aneurysm screening (65-75, male)
  {
    id: 'aaa-screening',
    name: 'AAA Screening',
    title: 'Abdominal Aortic Aneurysm Screening',
    description: 'Male patient aged 65-75. Consider one-time AAA screening if history of smoking.',
    ageRange: { min: 65, max: 75 },
    gender: 'male',
    priority: 'info',
    rationale: 'USPSTF recommends one-time ultrasound screening for AAA in men aged 65-75 who have ever smoked.',
    source: GUIDELINE_SOURCES.USPSTF,
  },
];

/**
 * All condition rules combined
 */
export const ALL_CONDITION_RULES: ConditionRule[] = [
  ...ICD10_CONDITION_RULES,
  ...SNOMED_CONDITION_RULES,
];

/**
 * Get condition rules by code system
 */
export function getConditionRulesBySystem(codeSystem: 'icd-10' | 'snomed'): ConditionRule[] {
  return ALL_CONDITION_RULES.filter((rule) => rule.codeSystem === codeSystem);
}

/**
 * Find matching condition rule for a code
 */
export function findMatchingConditionRule(
  code: string,
  system: string
): ConditionRule | undefined {
  const normalizedSystem = system.toLowerCase();

  let rules: ConditionRule[];

  if (normalizedSystem.includes('icd-10') || normalizedSystem.includes('icd10')) {
    rules = getConditionRulesBySystem('icd-10');
  } else if (normalizedSystem.includes('snomed')) {
    rules = getConditionRulesBySystem('snomed');
  } else {
    return undefined;
  }

  return rules.find((rule) => code.startsWith(rule.codePrefix));
}

/**
 * Get applicable screening rules for a patient
 */
export function getApplicableScreeningRules(
  age: number,
  gender?: string
): ScreeningRule[] {
  return SCREENING_RULES.filter((rule) => {
    // Check age range
    if (age < rule.ageRange.min || age > rule.ageRange.max) {
      return false;
    }

    // Check gender if specified
    if (rule.gender && gender) {
      const normalizedGender = gender.toLowerCase();
      if (normalizedGender !== rule.gender) {
        return false;
      }
    }

    return true;
  });
}
