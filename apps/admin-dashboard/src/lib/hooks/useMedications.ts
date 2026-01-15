import { useQuery, useMutation } from '@apollo/client';
import { GET_MEDICATIONS, GET_MEDICATION } from '../graphql/queries/admin';
import { CREATE_MEDICATION, UPDATE_MEDICATION, DELETE_MEDICATION, ADD_DRUG_INTERACTION, REMOVE_DRUG_INTERACTION } from '../graphql/mutations/admin';
import { SafetyRuleSeverity } from './useSafetyRules';

export interface DrugInteraction {
  id: string;
  interactingDrugCode: string;
  interactingDrugName: string;
  severity: SafetyRuleSeverity;
  description: string;
  clinicalEffect?: string;
  managementRecommendation?: string;
}

export interface Medication {
  code: string;
  name: string;
  genericName?: string;
  drugClass?: string;
  description?: string;
  contraindications?: string[];
  isActive: boolean;
  interactions: DrugInteraction[];
  createdAt?: string;
  updatedAt?: string;
}

interface MedicationFilterInput {
  drugClass?: string;
  searchTerm?: string;
  isActive?: boolean;
}

interface UseMedicationsOptions {
  filter?: MedicationFilterInput;
  first?: number;
  after?: string;
}

export function useMedications(options: UseMedicationsOptions = {}) {
  const { data, loading, error, refetch, fetchMore } = useQuery(GET_MEDICATIONS, {
    variables: {
      filter: options.filter,
      pagination: {
        first: options.first || 20,
        after: options.after,
      },
    },
    fetchPolicy: 'cache-and-network',
  });

  const medications: Medication[] = data?.medicationDefinitions?.edges?.map((edge: any) => edge.node) || [];
  const pageInfo = data?.medicationDefinitions?.pageInfo;
  const totalCount = data?.medicationDefinitions?.totalCount || 0;

  return {
    medications,
    pageInfo,
    totalCount,
    loading,
    error,
    refetch,
    fetchMore,
  };
}

export function useMedication(code: string) {
  const { data, loading, error, refetch } = useQuery(GET_MEDICATION, {
    variables: { code },
    skip: !code,
  });

  return {
    medication: data?.medicationDefinition as Medication | null,
    loading,
    error,
    refetch,
  };
}

export function useCreateMedication() {
  const [createMedication, { loading, error }] = useMutation(CREATE_MEDICATION, {
    refetchQueries: ['GetMedications', 'GetAdminStats'],
  });

  return {
    createMedication: (input: {
      code: string;
      name: string;
      genericName?: string;
      drugClass?: string;
      description?: string;
      contraindications?: string[];
    }) => createMedication({ variables: { input } }),
    loading,
    error,
  };
}

export function useUpdateMedication() {
  const [updateMedication, { loading, error }] = useMutation(UPDATE_MEDICATION, {
    refetchQueries: ['GetMedications'],
  });

  return {
    updateMedication: (code: string, input: Partial<{
      name: string;
      genericName: string;
      drugClass: string;
      description: string;
      contraindications: string[];
      isActive: boolean;
    }>) => updateMedication({ variables: { code, input } }),
    loading,
    error,
  };
}

export function useDeleteMedication() {
  const [deleteMedication, { loading, error }] = useMutation(DELETE_MEDICATION, {
    refetchQueries: ['GetMedications', 'GetAdminStats'],
  });

  return {
    deleteMedication: (code: string) => deleteMedication({ variables: { code } }),
    loading,
    error,
  };
}

export function useAddDrugInteraction() {
  const [addDrugInteraction, { loading, error }] = useMutation(ADD_DRUG_INTERACTION, {
    refetchQueries: ['GetMedication', 'GetMedications'],
  });

  return {
    addDrugInteraction: (input: {
      medicationCode: string;
      interactingDrugCode: string;
      severity: SafetyRuleSeverity;
      description: string;
      clinicalEffect?: string;
      managementRecommendation?: string;
    }) => addDrugInteraction({ variables: { input } }),
    loading,
    error,
  };
}

export function useRemoveDrugInteraction() {
  const [removeDrugInteraction, { loading, error }] = useMutation(REMOVE_DRUG_INTERACTION, {
    refetchQueries: ['GetMedication', 'GetMedications'],
  });

  return {
    removeDrugInteraction: (id: string) => removeDrugInteraction({ variables: { id } }),
    loading,
    error,
  };
}
