import { gql } from '@apollo/client';

// User mutations
export const CREATE_USER = gql`
  mutation CreateUser($input: CreateUserInput!) {
    createUser(input: $input) {
      id
      email
      firstName
      lastName
      role
      status
      createdAt
    }
  }
`;

export const UPDATE_USER = gql`
  mutation UpdateUser($id: ID!, $input: UpdateUserInput!) {
    updateUser(id: $id, input: $input) {
      id
      email
      firstName
      lastName
      role
      status
      updatedAt
    }
  }
`;

export const DELETE_USER = gql`
  mutation DeleteUser($id: ID!) {
    deleteUser(id: $id)
  }
`;

export const ACTIVATE_USER = gql`
  mutation ActivateUser($id: ID!) {
    activateUser(id: $id) {
      id
      status
    }
  }
`;

export const SUSPEND_USER = gql`
  mutation SuspendUser($id: ID!) {
    suspendUser(id: $id) {
      id
      status
    }
  }
`;

// Medication mutations
export const CREATE_MEDICATION = gql`
  mutation CreateMedication($input: CreateMedicationInput!) {
    createMedicationDefinition(input: $input) {
      code
      name
      genericName
      drugClass
      description
      isActive
    }
  }
`;

export const UPDATE_MEDICATION = gql`
  mutation UpdateMedication($code: String!, $input: UpdateMedicationInput!) {
    updateMedicationDefinition(code: $code, input: $input) {
      code
      name
      genericName
      drugClass
      description
      isActive
    }
  }
`;

export const DELETE_MEDICATION = gql`
  mutation DeleteMedication($code: String!) {
    deleteMedicationDefinition(code: $code)
  }
`;

export const ADD_DRUG_INTERACTION = gql`
  mutation AddDrugInteraction($input: CreateDrugInteractionInput!) {
    addDrugInteraction(input: $input) {
      id
      interactingDrugCode
      interactingDrugName
      severity
      description
    }
  }
`;

export const REMOVE_DRUG_INTERACTION = gql`
  mutation RemoveDrugInteraction($id: ID!) {
    removeDrugInteraction(id: $id)
  }
`;

// Safety rule mutations
export const CREATE_SAFETY_RULE = gql`
  mutation CreateSafetyRule($input: CreateSafetyRuleInput!) {
    createSafetyRule(input: $input) {
      id
      name
      ruleType
      severity
      description
      alertMessage
      isActive
    }
  }
`;

export const UPDATE_SAFETY_RULE = gql`
  mutation UpdateSafetyRule($id: ID!, $input: UpdateSafetyRuleInput!) {
    updateSafetyRule(id: $id, input: $input) {
      id
      name
      severity
      description
      alertMessage
      isActive
    }
  }
`;

export const DELETE_SAFETY_RULE = gql`
  mutation DeleteSafetyRule($id: ID!) {
    deleteSafetyRule(id: $id)
  }
`;

export const ACTIVATE_SAFETY_RULE = gql`
  mutation ActivateSafetyRule($id: ID!) {
    activateSafetyRule(id: $id) {
      id
      isActive
    }
  }
`;

export const DEACTIVATE_SAFETY_RULE = gql`
  mutation DeactivateSafetyRule($id: ID!) {
    deactivateSafetyRule(id: $id) {
      id
      isActive
    }
  }
`;

// Import job mutations
export const CREATE_IMPORT_JOB = gql`
  mutation CreateImportJob($type: ImportJobType!, $fileName: String!) {
    createImportJob(type: $type, fileName: $fileName) {
      id
      type
      status
      fileName
      createdAt
    }
  }
`;

export const CANCEL_IMPORT_JOB = gql`
  mutation CancelImportJob($id: ID!) {
    cancelImportJob(id: $id) {
      id
      status
    }
  }
`;
