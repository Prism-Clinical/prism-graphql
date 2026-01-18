import { useQuery, useMutation } from '@apollo/client';
import {
  GET_CARE_PLANS,
  GET_CARE_PLAN,
  GET_CARE_PLANS_FOR_PATIENT,
  GET_CARE_PLAN_TEMPLATES,
  GET_CARE_PLAN_STATS,
} from '../graphql/queries/careplans';
import {
  CREATE_CARE_PLAN,
  UPDATE_CARE_PLAN,
  UPDATE_CARE_PLAN_STATUS,
  ADD_CARE_PLAN_GOAL,
  UPDATE_CARE_PLAN_GOAL,
  ADD_CARE_PLAN_INTERVENTION,
  DELETE_CARE_PLAN,
  CREATE_CARE_PLAN_FROM_TEMPLATE,
} from '../graphql/mutations/careplans';

export interface CarePlanFilter {
  status?: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  patientId?: string;
}

export function useCarePlans(filter?: CarePlanFilter, first = 20) {
  const { data, loading, error, fetchMore, refetch } = useQuery(GET_CARE_PLANS, {
    variables: { filter, pagination: { first } },
    notifyOnNetworkStatusChange: true,
  });

  const loadMore = () => {
    if (data?.carePlans?.pageInfo?.hasNextPage) {
      fetchMore({
        variables: {
          pagination: {
            first,
            after: data.carePlans.pageInfo.endCursor,
          },
        },
      });
    }
  };

  return {
    carePlans: data?.carePlans?.edges?.map((e: any) => e.node) || [],
    totalCount: data?.carePlans?.totalCount || 0,
    hasNextPage: data?.carePlans?.pageInfo?.hasNextPage || false,
    loading,
    error,
    loadMore,
    refetch,
  };
}

export function useCarePlan(id: string) {
  const { data, loading, error, refetch } = useQuery(GET_CARE_PLAN, {
    variables: { id },
    skip: !id,
  });

  return {
    carePlan: data?.carePlan || null,
    loading,
    error,
    refetch,
  };
}

export function useCarePlansForPatient(patientId: string, first = 10) {
  const { data, loading, error, refetch } = useQuery(GET_CARE_PLANS_FOR_PATIENT, {
    variables: { patientId, pagination: { first } },
    skip: !patientId,
  });

  return {
    carePlans: data?.carePlansForPatient?.edges?.map((e: any) => e.node) || [],
    totalCount: data?.carePlansForPatient?.totalCount || 0,
    loading,
    error,
    refetch,
  };
}

export function useCarePlanTemplates(category?: string, first = 50) {
  const { data, loading, error } = useQuery(GET_CARE_PLAN_TEMPLATES, {
    variables: { filter: category ? { category } : undefined, pagination: { first } },
  });

  return {
    templates: data?.carePlanTemplates?.edges?.map((e: any) => e.node) || [],
    totalCount: data?.carePlanTemplates?.totalCount || 0,
    loading,
    error,
  };
}

export function useCarePlanStats() {
  const { data, loading, error, refetch } = useQuery(GET_CARE_PLAN_STATS, {
    pollInterval: 60000, // Refresh every minute
  });

  return {
    activeCount: data?.activeCarePlans?.totalCount || 0,
    draftCount: data?.draftCarePlans?.totalCount || 0,
    completedCount: data?.completedCarePlans?.totalCount || 0,
    loading,
    error,
    refetch,
  };
}

export function useCreateCarePlan() {
  const [createCarePlan, { data, loading, error }] = useMutation(CREATE_CARE_PLAN, {
    refetchQueries: [GET_CARE_PLANS, GET_CARE_PLAN_STATS],
  });

  const create = async (input: {
    patientId: string;
    title: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    goals?: Array<{ description: string; targetDate?: string }>;
    interventions?: Array<{
      type: string;
      description: string;
      frequency?: string;
      medicationCode?: string;
      procedureCode?: string;
    }>;
  }) => {
    const result = await createCarePlan({ variables: { input } });
    return result.data?.createCarePlan;
  };

  return {
    create,
    result: data?.createCarePlan,
    loading,
    error,
  };
}

export function useUpdateCarePlan() {
  const [updateCarePlan, { loading, error }] = useMutation(UPDATE_CARE_PLAN);

  const update = async (
    id: string,
    input: {
      title?: string;
      description?: string;
      startDate?: string;
      endDate?: string;
    }
  ) => {
    const result = await updateCarePlan({ variables: { id, input } });
    return result.data?.updateCarePlan;
  };

  return {
    update,
    loading,
    error,
  };
}

export function useUpdateCarePlanStatus() {
  const [updateStatus, { loading, error }] = useMutation(UPDATE_CARE_PLAN_STATUS, {
    refetchQueries: [GET_CARE_PLAN_STATS],
  });

  const update = async (id: string, status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED') => {
    const result = await updateStatus({ variables: { id, status } });
    return result.data?.updateCarePlanStatus;
  };

  return {
    update,
    loading,
    error,
  };
}

export function useAddCarePlanGoal() {
  const [addGoal, { loading, error }] = useMutation(ADD_CARE_PLAN_GOAL);

  const add = async (
    carePlanId: string,
    input: { description: string; targetDate?: string }
  ) => {
    const result = await addGoal({ variables: { carePlanId, input } });
    return result.data?.addCarePlanGoal;
  };

  return {
    add,
    loading,
    error,
  };
}

export function useUpdateCarePlanGoal() {
  const [updateGoal, { loading, error }] = useMutation(UPDATE_CARE_PLAN_GOAL);

  const update = async (
    goalId: string,
    input: { description?: string; targetDate?: string; status?: string; progress?: number }
  ) => {
    const result = await updateGoal({ variables: { goalId, input } });
    return result.data?.updateCarePlanGoal;
  };

  return {
    update,
    loading,
    error,
  };
}

export function useAddCarePlanIntervention() {
  const [addIntervention, { loading, error }] = useMutation(ADD_CARE_PLAN_INTERVENTION);

  const add = async (
    carePlanId: string,
    input: {
      type: string;
      description: string;
      frequency?: string;
      medicationCode?: string;
      procedureCode?: string;
    }
  ) => {
    const result = await addIntervention({ variables: { carePlanId, input } });
    return result.data?.addCarePlanIntervention;
  };

  return {
    add,
    loading,
    error,
  };
}

export function useDeleteCarePlan() {
  const [deleteCarePlan, { loading, error }] = useMutation(DELETE_CARE_PLAN, {
    refetchQueries: [GET_CARE_PLANS, GET_CARE_PLAN_STATS],
  });

  const remove = async (id: string) => {
    const result = await deleteCarePlan({ variables: { id } });
    return result.data?.deleteCarePlan;
  };

  return {
    remove,
    loading,
    error,
  };
}

export function useCreateCarePlanFromTemplate() {
  const [createFromTemplate, { loading, error }] = useMutation(CREATE_CARE_PLAN_FROM_TEMPLATE, {
    refetchQueries: [GET_CARE_PLANS, GET_CARE_PLAN_STATS],
  });

  const create = async (templateId: string, patientId: string) => {
    const result = await createFromTemplate({ variables: { templateId, patientId } });
    return result.data?.createCarePlanFromTemplate;
  };

  return {
    create,
    loading,
    error,
  };
}
