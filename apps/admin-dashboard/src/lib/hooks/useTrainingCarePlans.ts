import { useQuery, useMutation } from '@apollo/client';
import {
  GET_TRAINING_CARE_PLANS,
  GET_TRAINING_CARE_PLAN,
} from '../graphql/queries/carePlans';
import {
  CREATE_TRAINING_CARE_PLAN,
  UPDATE_TRAINING_CARE_PLAN,
  DELETE_TRAINING_CARE_PLAN,
  ADD_TRAINING_GOAL,
  REMOVE_TRAINING_GOAL,
  ADD_TRAINING_INTERVENTION,
  REMOVE_TRAINING_INTERVENTION,
} from '../graphql/mutations/carePlans';

export type CarePlanStatus = 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type GoalStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'ACHIEVED' | 'NOT_ACHIEVED' | 'CANCELLED';
export type GoalPriority = 'HIGH' | 'MEDIUM' | 'LOW';
export type InterventionStatus = 'PENDING' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export type InterventionType =
  | 'MEDICATION'
  | 'PROCEDURE'
  | 'LIFESTYLE'
  | 'MONITORING'
  | 'REFERRAL'
  | 'EDUCATION'
  | 'FOLLOW_UP';

export interface CarePlanGoal {
  id: string;
  description: string;
  targetValue?: string;
  targetDate?: string;
  status: GoalStatus;
  priority: GoalPriority;
  currentValue?: string;
  percentComplete?: number;
  guidelineReference?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CarePlanIntervention {
  id: string;
  type: InterventionType;
  description: string;
  medicationCode?: string;
  dosage?: string;
  frequency?: string;
  procedureCode?: string;
  referralSpecialty?: string;
  status: InterventionStatus;
  scheduledDate?: string;
  completedDate?: string;
  patientInstructions?: string;
  providerNotes?: string;
  guidelineReference?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingCarePlan {
  id: string;
  title: string;
  status: CarePlanStatus;
  conditionCodes: string[];
  startDate: string;
  targetEndDate?: string;
  isTrainingExample: boolean;
  trainingDescription?: string;
  trainingTags: string[];
  goals: CarePlanGoal[];
  interventions: CarePlanIntervention[];
  createdAt: string;
  updatedAt: string;
}

interface TrainingCarePlanFilterInput {
  status?: CarePlanStatus;
  conditionCode?: string;
  trainingTag?: string;
  createdAfter?: string;
  createdBefore?: string;
}

interface UseTrainingCarePlansOptions {
  filter?: TrainingCarePlanFilterInput;
  first?: number;
  after?: string;
}

export function useTrainingCarePlans(options: UseTrainingCarePlansOptions = {}) {
  const { data, loading, error, refetch, fetchMore } = useQuery(GET_TRAINING_CARE_PLANS, {
    variables: {
      filter: options.filter,
      pagination: {
        first: options.first || 20,
        after: options.after,
      },
    },
    fetchPolicy: 'cache-and-network',
  });

  const carePlans: TrainingCarePlan[] = data?.trainingCarePlans?.edges?.map((edge: any) => edge.node) || [];
  const pageInfo = data?.trainingCarePlans?.pageInfo;
  const totalCount = data?.trainingCarePlans?.totalCount || 0;

  return {
    carePlans,
    pageInfo,
    totalCount,
    loading,
    error,
    refetch,
    fetchMore,
  };
}

export function useTrainingCarePlan(id: string) {
  const { data, loading, error, refetch } = useQuery(GET_TRAINING_CARE_PLAN, {
    variables: { id },
    skip: !id,
  });

  return {
    carePlan: data?.trainingCarePlan as TrainingCarePlan | null,
    loading,
    error,
    refetch,
  };
}

export interface CreateTrainingCarePlanInput {
  title: string;
  conditionCodes: string[];
  trainingDescription?: string;
  trainingTags?: string[];
  startDate: string;
  targetEndDate?: string;
  goals?: Array<{
    description: string;
    targetValue?: string;
    targetDate?: string;
    priority: GoalPriority;
    status?: GoalStatus;
  }>;
  interventions?: Array<{
    type: InterventionType;
    description: string;
    medicationCode?: string;
    dosage?: string;
    frequency?: string;
    procedureCode?: string;
    referralSpecialty?: string;
    status?: InterventionStatus;
    scheduledDate?: string;
    patientInstructions?: string;
  }>;
}

export function useCreateTrainingCarePlan() {
  const [createCarePlan, { loading, error }] = useMutation(CREATE_TRAINING_CARE_PLAN, {
    refetchQueries: ['GetTrainingCarePlans'],
  });

  return {
    createCarePlan: (input: CreateTrainingCarePlanInput) =>
      createCarePlan({ variables: { input } }),
    loading,
    error,
  };
}

export interface UpdateTrainingCarePlanInput {
  title?: string;
  status?: CarePlanStatus;
  conditionCodes?: string[];
  trainingDescription?: string;
  trainingTags?: string[];
  targetEndDate?: string;
}

export function useUpdateTrainingCarePlan() {
  const [updateCarePlan, { loading, error }] = useMutation(UPDATE_TRAINING_CARE_PLAN, {
    refetchQueries: ['GetTrainingCarePlans', 'GetTrainingCarePlan'],
  });

  return {
    updateCarePlan: (id: string, input: UpdateTrainingCarePlanInput) =>
      updateCarePlan({ variables: { id, input } }),
    loading,
    error,
  };
}

export function useDeleteTrainingCarePlan() {
  const [deleteCarePlan, { loading, error }] = useMutation(DELETE_TRAINING_CARE_PLAN, {
    refetchQueries: ['GetTrainingCarePlans'],
  });

  return {
    deleteCarePlan: (id: string) => deleteCarePlan({ variables: { id } }),
    loading,
    error,
  };
}

// Goal management hooks
export interface CreateTrainingGoalInput {
  description: string;
  targetValue?: string;
  targetDate?: string;
  priority: GoalPriority;
  status?: GoalStatus;
}

export function useAddTrainingGoal() {
  const [addGoal, { loading, error }] = useMutation(ADD_TRAINING_GOAL, {
    refetchQueries: ['GetTrainingCarePlan'],
  });

  return {
    addGoal: (carePlanId: string, input: CreateTrainingGoalInput) =>
      addGoal({ variables: { carePlanId, input } }),
    loading,
    error,
  };
}

export function useRemoveTrainingGoal() {
  const [removeGoal, { loading, error }] = useMutation(REMOVE_TRAINING_GOAL, {
    refetchQueries: ['GetTrainingCarePlan'],
  });

  return {
    removeGoal: (goalId: string) => removeGoal({ variables: { goalId } }),
    loading,
    error,
  };
}

// Intervention management hooks
export interface CreateTrainingInterventionInput {
  type: InterventionType;
  description: string;
  medicationCode?: string;
  dosage?: string;
  frequency?: string;
  procedureCode?: string;
  referralSpecialty?: string;
  status?: InterventionStatus;
  scheduledDate?: string;
  patientInstructions?: string;
}

export function useAddTrainingIntervention() {
  const [addIntervention, { loading, error }] = useMutation(ADD_TRAINING_INTERVENTION, {
    refetchQueries: ['GetTrainingCarePlan'],
  });

  return {
    addIntervention: (carePlanId: string, input: CreateTrainingInterventionInput) =>
      addIntervention({ variables: { carePlanId, input } }),
    loading,
    error,
  };
}

export function useRemoveTrainingIntervention() {
  const [removeIntervention, { loading, error }] = useMutation(REMOVE_TRAINING_INTERVENTION, {
    refetchQueries: ['GetTrainingCarePlan'],
  });

  return {
    removeIntervention: (interventionId: string) =>
      removeIntervention({ variables: { interventionId } }),
    loading,
    error,
  };
}
