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

export const PENDING_APPROVALS = gql`
  query PendingApprovals($first: Int, $after: String) {
    pendingApprovals(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          status
          createdAt
          providerUser {
            id
            email
            firstName
            lastName
            npi
            role
            institution {
              id
              name
              code
            }
          }
        }
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
