import { useQuery, useMutation } from '@apollo/client';
import { GET_ADMIN_USERS } from '../graphql/queries/admin';
import { CREATE_USER, UPDATE_USER, DELETE_USER, ACTIVATE_USER, SUSPEND_USER } from '../graphql/mutations/admin';

export type UserRole = 'ADMIN' | 'CLINICIAN' | 'REVIEWER' | 'AUDITOR' | 'READ_ONLY';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING';

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt?: string;
  createdAt: string;
}

interface UserFilterInput {
  role?: UserRole;
  status?: UserStatus;
  searchTerm?: string;
}

interface UseUsersOptions {
  filter?: UserFilterInput;
  first?: number;
  after?: string;
}

export function useUsers(options: UseUsersOptions = {}) {
  const { data, loading, error, refetch, fetchMore } = useQuery(GET_ADMIN_USERS, {
    variables: {
      filter: options.filter,
      pagination: {
        first: options.first || 20,
        after: options.after,
      },
    },
    fetchPolicy: 'cache-and-network',
  });

  const users: AdminUser[] = data?.adminUsers?.edges?.map((edge: any) => edge.node) || [];
  const pageInfo = data?.adminUsers?.pageInfo;
  const totalCount = data?.adminUsers?.totalCount || 0;

  return {
    users,
    pageInfo,
    totalCount,
    loading,
    error,
    refetch,
    fetchMore,
  };
}

export function useCreateUser() {
  const [createUser, { loading, error }] = useMutation(CREATE_USER, {
    refetchQueries: ['GetAdminUsers', 'GetAdminStats'],
  });

  return {
    createUser: (input: { email: string; firstName: string; lastName: string; role: UserRole }) =>
      createUser({ variables: { input } }),
    loading,
    error,
  };
}

export function useUpdateUser() {
  const [updateUser, { loading, error }] = useMutation(UPDATE_USER, {
    refetchQueries: ['GetAdminUsers'],
  });

  return {
    updateUser: (id: string, input: Partial<{ firstName: string; lastName: string; role: UserRole; status: UserStatus }>) =>
      updateUser({ variables: { id, input } }),
    loading,
    error,
  };
}

export function useDeleteUser() {
  const [deleteUser, { loading, error }] = useMutation(DELETE_USER, {
    refetchQueries: ['GetAdminUsers', 'GetAdminStats'],
  });

  return {
    deleteUser: (id: string) => deleteUser({ variables: { id } }),
    loading,
    error,
  };
}

export function useActivateUser() {
  const [activateUser, { loading, error }] = useMutation(ACTIVATE_USER, {
    refetchQueries: ['GetAdminUsers', 'GetAdminStats'],
  });

  return {
    activateUser: (id: string) => activateUser({ variables: { id } }),
    loading,
    error,
  };
}

export function useSuspendUser() {
  const [suspendUser, { loading, error }] = useMutation(SUSPEND_USER, {
    refetchQueries: ['GetAdminUsers', 'GetAdminStats'],
  });

  return {
    suspendUser: (id: string) => suspendUser({ variables: { id } }),
    loading,
    error,
  };
}
