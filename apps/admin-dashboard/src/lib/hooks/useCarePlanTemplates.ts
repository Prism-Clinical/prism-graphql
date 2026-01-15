import { useQuery, useMutation } from '@apollo/client';
import {
  GET_CARE_PLAN_TEMPLATES,
  GET_CARE_PLAN_TEMPLATE,
} from '../graphql/queries/carePlans';
import {
  CREATE_CARE_PLAN_TEMPLATE,
  UPDATE_CARE_PLAN_TEMPLATE,
  DELETE_CARE_PLAN_TEMPLATE,
} from '../graphql/mutations/carePlans';

export type TemplateCategory =
  | 'CHRONIC_DISEASE'
  | 'PREVENTIVE_CARE'
  | 'POST_PROCEDURE'
  | 'MEDICATION_MANAGEMENT'
  | 'LIFESTYLE_MODIFICATION';

export type GoalPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export type InterventionType =
  | 'MEDICATION'
  | 'PROCEDURE'
  | 'LIFESTYLE'
  | 'MONITORING'
  | 'REFERRAL'
  | 'EDUCATION'
  | 'FOLLOW_UP';

export interface TemplateGoal {
  description: string;
  defaultTargetValue?: string;
  defaultTargetDays?: number;
  priority: GoalPriority;
}

export interface TemplateIntervention {
  type: InterventionType;
  description: string;
  medicationCode?: string;
  procedureCode?: string;
  defaultScheduleDays?: number;
}

export interface CarePlanTemplate {
  id: string;
  name: string;
  description?: string;
  category: TemplateCategory;
  conditionCodes: string[];
  guidelineSource?: string;
  evidenceGrade?: string;
  isActive: boolean;
  version: string;
  defaultGoals: TemplateGoal[];
  defaultInterventions: TemplateIntervention[];
  createdAt: string;
  updatedAt: string;
}

interface TemplateFilterInput {
  category?: TemplateCategory;
  conditionCode?: string;
  isActive?: boolean;
}

interface UseCarePlanTemplatesOptions {
  filter?: TemplateFilterInput;
  first?: number;
  after?: string;
}

export function useCarePlanTemplates(options: UseCarePlanTemplatesOptions = {}) {
  const { data, loading, error, refetch, fetchMore } = useQuery(GET_CARE_PLAN_TEMPLATES, {
    variables: {
      filter: options.filter,
      pagination: {
        first: options.first || 20,
        after: options.after,
      },
    },
    fetchPolicy: 'cache-and-network',
  });

  const templates: CarePlanTemplate[] = data?.carePlanTemplates?.edges?.map((edge: any) => edge.node) || [];
  const pageInfo = data?.carePlanTemplates?.pageInfo;
  const totalCount = data?.carePlanTemplates?.totalCount || 0;

  return {
    templates,
    pageInfo,
    totalCount,
    loading,
    error,
    refetch,
    fetchMore,
  };
}

export function useCarePlanTemplate(id: string) {
  const { data, loading, error, refetch } = useQuery(GET_CARE_PLAN_TEMPLATE, {
    variables: { id },
    skip: !id,
  });

  return {
    template: data?.carePlanTemplate as CarePlanTemplate | null,
    loading,
    error,
    refetch,
  };
}

export interface CreateCarePlanTemplateInput {
  name: string;
  description?: string;
  category: TemplateCategory;
  conditionCodes: string[];
  guidelineSource?: string;
  evidenceGrade?: string;
  goals?: Array<{
    description: string;
    defaultTargetValue?: string;
    defaultTargetDays?: number;
    priority: GoalPriority;
  }>;
  interventions?: Array<{
    type: InterventionType;
    description: string;
    medicationCode?: string;
    procedureCode?: string;
    defaultScheduleDays?: number;
  }>;
}

export function useCreateCarePlanTemplate() {
  const [createTemplate, { loading, error }] = useMutation(CREATE_CARE_PLAN_TEMPLATE, {
    refetchQueries: ['GetCarePlanTemplates'],
  });

  return {
    createTemplate: (input: CreateCarePlanTemplateInput) =>
      createTemplate({ variables: { input } }),
    loading,
    error,
  };
}

export interface UpdateCarePlanTemplateInput {
  name?: string;
  description?: string;
  category?: TemplateCategory;
  conditionCodes?: string[];
  guidelineSource?: string;
  evidenceGrade?: string;
  isActive?: boolean;
}

export function useUpdateCarePlanTemplate() {
  const [updateTemplate, { loading, error }] = useMutation(UPDATE_CARE_PLAN_TEMPLATE, {
    refetchQueries: ['GetCarePlanTemplates', 'GetCarePlanTemplate'],
  });

  return {
    updateTemplate: (id: string, input: UpdateCarePlanTemplateInput) =>
      updateTemplate({ variables: { id, input } }),
    loading,
    error,
  };
}

export function useDeleteCarePlanTemplate() {
  const [deleteTemplate, { loading, error }] = useMutation(DELETE_CARE_PLAN_TEMPLATE, {
    refetchQueries: ['GetCarePlanTemplates'],
  });

  return {
    deleteTemplate: (id: string) => deleteTemplate({ variables: { id } }),
    loading,
    error,
  };
}
