import { useQuery } from '@apollo/client';
import { GET_PATIENTS, GET_PATIENT, GET_PATIENT_SAFETY_SUMMARY } from '../graphql/queries/patients';

export function usePatients(limit = 20, offset = 0) {
  const { data, loading, error, refetch } = useQuery(GET_PATIENTS, {
    variables: { limit, offset },
  });

  return {
    patients: data?.patients || [],
    loading,
    error,
    refetch,
  };
}

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

export function usePatientSafetySummary(patientId: string) {
  const { data, loading, error, refetch } = useQuery(GET_PATIENT_SAFETY_SUMMARY, {
    variables: { patientId },
    skip: !patientId,
  });

  return {
    patient: data?.patient || null,
    safetyChecks: data?.safetyChecksForPatient?.edges?.map((e: any) => e.node) || [],
    safetyCheckCount: data?.safetyChecksForPatient?.totalCount || 0,
    carePlans: data?.carePlansForPatient?.edges?.map((e: any) => e.node) || [],
    carePlanCount: data?.carePlansForPatient?.totalCount || 0,
    loading,
    error,
    refetch,
  };
}
