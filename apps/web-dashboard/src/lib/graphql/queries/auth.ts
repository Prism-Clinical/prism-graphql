import { gql } from '@apollo/client';

export const ME = gql`
  query Me {
    me {
      id
      email
      firstName
      lastName
      userType
      roles
      institutionId
      providerId
      status
      emailVerified
    }
  }
`;

export const VALIDATE_TOKEN = gql`
  query ValidateToken($token: String!) {
    validateToken(token: $token) {
      isValid
      user {
        id
        email
        firstName
        lastName
        userType
        roles
        status
        emailVerified
      }
      error
    }
  }
`;

export const VALIDATE_NPI = gql`
  query ValidateNPI($npi: String!) {
    validateNPI(npi: $npi) {
      isValid
      providerName
      specialty
      error
    }
  }
`;

export const IS_APPROVED_DOMAIN = gql`
  query IsApprovedDomain($domain: String!) {
    isApprovedDomain(domain: $domain)
  }
`;

export const INSTITUTION_BY_CODE = gql`
  query InstitutionByCode($code: String!) {
    institutionByCode(code: $code) {
      id
      name
      code
      domain
    }
  }
`;

export const INSTITUTIONS = gql`
  query Institutions {
    institutions {
      id
      name
      code
      domain
    }
  }
`;
