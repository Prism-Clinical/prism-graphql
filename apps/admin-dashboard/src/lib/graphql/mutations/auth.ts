import { gql } from '@apollo/client';

export const ADMIN_SIGNUP = gql`
  mutation AdminSignup($input: AdminSignupInput!) {
    adminSignup(input: $input) {
      accessToken
      refreshToken
      expiresIn
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
    }
  }
`;

export const LOGIN = gql`
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
      refreshToken
      expiresIn
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
    }
  }
`;

export const LOGOUT = gql`
  mutation Logout {
    logout
  }
`;

export const REFRESH_TOKEN = gql`
  mutation RefreshToken($input: RefreshTokenInput!) {
    refreshToken(input: $input) {
      accessToken
      refreshToken
      expiresIn
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
    }
  }
`;

export const VERIFY_EMAIL = gql`
  mutation VerifyEmail($token: String!) {
    verifyEmail(token: $token) {
      success
      message
    }
  }
`;

export const REQUEST_PASSWORD_RESET = gql`
  mutation RequestPasswordReset($input: PasswordResetRequestInput!) {
    requestPasswordReset(input: $input) {
      success
      message
    }
  }
`;

export const RESET_PASSWORD = gql`
  mutation ResetPassword($input: PasswordResetInput!) {
    resetPassword(input: $input) {
      success
      message
    }
  }
`;

export const CHANGE_PASSWORD = gql`
  mutation ChangePassword($input: ChangePasswordInput!) {
    changePassword(input: $input) {
      success
      message
    }
  }
`;

export const APPROVE_PROVIDER = gql`
  mutation ApproveProvider($input: ApprovalDecisionInput!) {
    approveProvider(input: $input) {
      success
      message
      providerUser {
        id
        email
        firstName
        lastName
        npi
        role
        status
        institution {
          id
          name
        }
      }
    }
  }
`;
