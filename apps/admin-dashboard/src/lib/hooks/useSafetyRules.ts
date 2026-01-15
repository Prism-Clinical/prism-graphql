import { useQuery, useMutation } from '@apollo/client';
import { GET_SAFETY_RULES, GET_SAFETY_RULE } from '../graphql/queries/admin';
import { CREATE_SAFETY_RULE, UPDATE_SAFETY_RULE, DELETE_SAFETY_RULE, ACTIVATE_SAFETY_RULE, DEACTIVATE_SAFETY_RULE } from '../graphql/mutations/admin';

export type SafetyRuleType = 'DRUG_INTERACTION' | 'ALLERGY_ALERT' | 'CONTRAINDICATION' | 'DOSAGE_CHECK' | 'AGE_RESTRICTION' | 'LAB_VALUE_CHECK';
export type SafetyRuleSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface SafetyRule {
  id: string;
  name: string;
  ruleType: SafetyRuleType;
  severity: SafetyRuleSeverity;
  description: string;
  alertMessage: string;
  triggerConditions?: string;
  isActive: boolean;
  version: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
}

interface SafetyRuleFilterInput {
  ruleType?: SafetyRuleType;
  severity?: SafetyRuleSeverity;
  isActive?: boolean;
  searchTerm?: string;
}

interface UseSafetyRulesOptions {
  filter?: SafetyRuleFilterInput;
  first?: number;
  after?: string;
}

export function useSafetyRules(options: UseSafetyRulesOptions = {}) {
  const { data, loading, error, refetch, fetchMore } = useQuery(GET_SAFETY_RULES, {
    variables: {
      filter: options.filter,
      pagination: {
        first: options.first || 20,
        after: options.after,
      },
    },
    fetchPolicy: 'cache-and-network',
  });

  const rules: SafetyRule[] = data?.safetyRules?.edges?.map((edge: any) => edge.node) || [];
  const pageInfo = data?.safetyRules?.pageInfo;
  const totalCount = data?.safetyRules?.totalCount || 0;

  return {
    rules,
    pageInfo,
    totalCount,
    loading,
    error,
    refetch,
    fetchMore,
  };
}

export function useSafetyRule(id: string) {
  const { data, loading, error, refetch } = useQuery(GET_SAFETY_RULE, {
    variables: { id },
    skip: !id,
  });

  return {
    rule: data?.safetyRule as SafetyRule | null,
    loading,
    error,
    refetch,
  };
}

export function useCreateSafetyRule() {
  const [createSafetyRule, { loading, error }] = useMutation(CREATE_SAFETY_RULE, {
    refetchQueries: ['GetSafetyRules', 'GetAdminStats'],
  });

  return {
    createSafetyRule: (input: {
      name: string;
      ruleType: SafetyRuleType;
      severity: SafetyRuleSeverity;
      description: string;
      alertMessage: string;
      triggerConditions: string;
    }) => createSafetyRule({ variables: { input } }),
    loading,
    error,
  };
}

export function useUpdateSafetyRule() {
  const [updateSafetyRule, { loading, error }] = useMutation(UPDATE_SAFETY_RULE, {
    refetchQueries: ['GetSafetyRules'],
  });

  return {
    updateSafetyRule: (id: string, input: Partial<{
      name: string;
      severity: SafetyRuleSeverity;
      description: string;
      alertMessage: string;
      triggerConditions: string;
      isActive: boolean;
    }>) => updateSafetyRule({ variables: { id, input } }),
    loading,
    error,
  };
}

export function useDeleteSafetyRule() {
  const [deleteSafetyRule, { loading, error }] = useMutation(DELETE_SAFETY_RULE, {
    refetchQueries: ['GetSafetyRules', 'GetAdminStats'],
  });

  return {
    deleteSafetyRule: (id: string) => deleteSafetyRule({ variables: { id } }),
    loading,
    error,
  };
}

export function useActivateSafetyRule() {
  const [activateSafetyRule, { loading, error }] = useMutation(ACTIVATE_SAFETY_RULE, {
    refetchQueries: ['GetSafetyRules', 'GetAdminStats'],
  });

  return {
    activateSafetyRule: (id: string) => activateSafetyRule({ variables: { id } }),
    loading,
    error,
  };
}

export function useDeactivateSafetyRule() {
  const [deactivateSafetyRule, { loading, error }] = useMutation(DEACTIVATE_SAFETY_RULE, {
    refetchQueries: ['GetSafetyRules', 'GetAdminStats'],
  });

  return {
    deactivateSafetyRule: (id: string) => deactivateSafetyRule({ variables: { id } }),
    loading,
    error,
  };
}
