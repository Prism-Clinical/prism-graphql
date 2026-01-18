import { useQuery } from '@apollo/client';
import {
  GET_PATIENT,
  GET_PATIENTS,
  GET_PATIENT_SAFETY_SUMMARY,
  SEARCH_PATIENTS,
} from '../graphql/queries/patients';

export function usePatient(id: string) {
  const { data, loading, error, refetch } = useQuery(GET_PATIENT, {
    variables: { id },
    skip: !id,
  });

  return {
    patient: data?.patient || null,
    loading,
    error,
    refetch,
  };
}

export function usePatients(search?: string, first = 20) {
  const { data, loading, error, fetchMore, refetch } = useQuery(GET_PATIENTS, {
    variables: { search, first },
    notifyOnNetworkStatusChange: true,
  });

  const loadMore = () => {
    if (data?.patients?.pageInfo?.hasNextPage) {
      fetchMore({
        variables: {
          after: data.patients.pageInfo.endCursor,
        },
      });
    }
  };

  return {
    patients: data?.patients?.edges?.map((e: any) => e.node) || [],
    totalCount: data?.patients?.totalCount || 0,
    hasNextPage: data?.patients?.pageInfo?.hasNextPage || false,
    loading,
    error,
    loadMore,
    refetch,
  };
}

export function usePatientSafetySummary(patientId: string) {
  const { data, loading, error, refetch } = useQuery(GET_PATIENT_SAFETY_SUMMARY, {
    variables: { patientId },
    skip: !patientId,
  });

  return {
    patient: data?.patient || null,
    activeAlerts: data?.patient?.activeSafetyAlerts || [],
    safetyChecks: data?.safetyChecksForPatient?.edges?.map((e: any) => e.node) || [],
    safetyCheckCount: data?.safetyChecksForPatient?.totalCount || 0,
    carePlans: data?.carePlansForPatient?.edges?.map((e: any) => e.node) || [],
    carePlanCount: data?.carePlansForPatient?.totalCount || 0,
    loading,
    error,
    refetch,
  };
}

export function usePatientSearch(search: string, first = 10) {
  const { data, loading, error } = useQuery(SEARCH_PATIENTS, {
    variables: { search, first },
    skip: !search || search.length < 2,
  });

  return {
    results: data?.patients?.edges?.map((e: any) => e.node) || [],
    loading,
    error,
  };
}
