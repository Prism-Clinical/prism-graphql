import { useQuery, useMutation } from '@apollo/client';
import { GET_IMPORT_JOBS } from '../graphql/queries/admin';
import { CREATE_IMPORT_JOB, CANCEL_IMPORT_JOB } from '../graphql/mutations/admin';

export type ImportJobType = 'PATIENTS' | 'CARE_PLAN_TEMPLATES' | 'SAFETY_RULES' | 'MEDICATIONS';
export type ImportJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface ImportError {
  rowNumber: number;
  field?: string;
  message: string;
  value?: string;
}

export interface ImportJob {
  id: string;
  type: ImportJobType;
  status: ImportJobStatus;
  fileName: string;
  totalRows: number;
  processedRows: number;
  successRows: number;
  errorRows: number;
  errors?: ImportError[];
  startedAt?: string;
  completedAt?: string;
  createdBy?: string;
  createdAt: string;
}

interface ImportJobFilterInput {
  type?: ImportJobType;
  status?: ImportJobStatus;
}

interface UseImportJobsOptions {
  filter?: ImportJobFilterInput;
  first?: number;
  after?: string;
}

export function useImportJobs(options: UseImportJobsOptions = {}) {
  const { data, loading, error, refetch, fetchMore } = useQuery(GET_IMPORT_JOBS, {
    variables: {
      filter: options.filter,
      pagination: {
        first: options.first || 20,
        after: options.after,
      },
    },
    fetchPolicy: 'cache-and-network',
  });

  const jobs: ImportJob[] = data?.importJobs?.edges?.map((edge: any) => edge.node) || [];
  const pageInfo = data?.importJobs?.pageInfo;
  const totalCount = data?.importJobs?.totalCount || 0;

  return {
    jobs,
    pageInfo,
    totalCount,
    loading,
    error,
    refetch,
    fetchMore,
  };
}

export function useCreateImportJob() {
  const [createImportJob, { loading, error }] = useMutation(CREATE_IMPORT_JOB, {
    refetchQueries: ['GetImportJobs', 'GetAdminStats'],
  });

  return {
    createImportJob: (type: ImportJobType, fileName: string) =>
      createImportJob({ variables: { type, fileName } }),
    loading,
    error,
  };
}

export function useCancelImportJob() {
  const [cancelImportJob, { loading, error }] = useMutation(CANCEL_IMPORT_JOB, {
    refetchQueries: ['GetImportJobs'],
  });

  return {
    cancelImportJob: (id: string) => cancelImportJob({ variables: { id } }),
    loading,
    error,
  };
}
