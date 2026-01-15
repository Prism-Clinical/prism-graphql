import { gql } from '@apollo/client';

export const GET_ADMIN_STATS = gql`
  query GetAdminStats {
    adminStats {
      totalUsers
      activeUsers
      totalTemplates
      activeTemplates
      totalSafetyRules
      activeSafetyRules
      totalMedications
      recentImportJobs
      recentAuditLogs
    }
  }
`;

export const GET_ADMIN_USERS = gql`
  query GetAdminUsers($filter: UserFilterInput, $pagination: PaginationInput) {
    adminUsers(filter: $filter, pagination: $pagination) {
      edges {
        node {
          id
          email
          firstName
          lastName
          role
          status
          lastLoginAt
          createdAt
        }
        cursor
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
`;

export const GET_ADMIN_USER = gql`
  query GetAdminUser($id: ID!) {
    adminUser(id: $id) {
      id
      email
      firstName
      lastName
      role
      status
      lastLoginAt
      createdAt
      updatedAt
    }
  }
`;

export const GET_MEDICATIONS = gql`
  query GetMedications($filter: MedicationFilterInput, $pagination: PaginationInput) {
    medicationDefinitions(filter: $filter, pagination: $pagination) {
      edges {
        node {
          code
          name
          genericName
          drugClass
          description
          isActive
          interactions {
            id
            interactingDrugCode
            interactingDrugName
            severity
            description
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
`;

export const GET_MEDICATION = gql`
  query GetMedication($code: String!) {
    medicationDefinition(code: $code) {
      code
      name
      genericName
      drugClass
      description
      contraindications
      isActive
      interactions {
        id
        interactingDrugCode
        interactingDrugName
        severity
        description
        clinicalEffect
        managementRecommendation
      }
      createdAt
      updatedAt
    }
  }
`;

export const GET_SAFETY_RULES = gql`
  query GetSafetyRules($filter: SafetyRuleFilterInput, $pagination: PaginationInput) {
    safetyRules(filter: $filter, pagination: $pagination) {
      edges {
        node {
          id
          name
          ruleType
          severity
          description
          alertMessage
          isActive
          version
          createdAt
        }
        cursor
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
`;

export const GET_SAFETY_RULE = gql`
  query GetSafetyRule($id: ID!) {
    safetyRule(id: $id) {
      id
      name
      ruleType
      severity
      description
      alertMessage
      triggerConditions
      isActive
      version
      createdAt
      updatedAt
    }
  }
`;

export const GET_AUDIT_LOGS = gql`
  query GetAuditLogs($filter: AuditLogFilterInput, $pagination: PaginationInput) {
    auditLogs(filter: $filter, pagination: $pagination) {
      edges {
        node {
          id
          action
          entityType
          entityId
          userId
          userName
          changes
          timestamp
        }
        cursor
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
`;

export const GET_IMPORT_JOBS = gql`
  query GetImportJobs($filter: ImportJobFilterInput, $pagination: PaginationInput) {
    importJobs(filter: $filter, pagination: $pagination) {
      edges {
        node {
          id
          type
          status
          fileName
          totalRows
          processedRows
          successRows
          errorRows
          startedAt
          completedAt
          createdAt
        }
        cursor
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
`;

export const GET_CARE_PLAN_TEMPLATES = gql`
  query GetCarePlanTemplates($filter: TemplateFilterInput, $pagination: PaginationInput) {
    carePlanTemplates(filter: $filter, pagination: $pagination) {
      edges {
        node {
          id
          name
          category
          conditionCodes
          guidelineSource
          evidenceGrade
          isActive
          version
          createdAt
        }
        cursor
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      totalCount
    }
  }
`;

export const GET_CARE_PLAN_TEMPLATE = gql`
  query GetCarePlanTemplate($id: ID!) {
    carePlanTemplate(id: $id) {
      id
      name
      category
      conditionCodes
      guidelineSource
      evidenceGrade
      isActive
      version
      defaultGoals {
        description
        defaultTargetValue
        defaultTargetDays
        priority
      }
      defaultInterventions {
        type
        description
        medicationCode
        procedureCode
        defaultScheduleDays
      }
      createdAt
      updatedAt
    }
  }
`;
