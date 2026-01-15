import { MutationResolvers } from '../__generated__/resolvers-types';
import { DataSourceContext } from '../types/DataSourceContext';
import { hashPassword, verifyPassword, validatePasswordStrength } from '../utils/password';
import { isValidEmail, getEmailDomain, isPrismClinicalEmail, generateToken, hashToken } from '../utils/validation';
import { generateTokenPair, revokeUserTokens, blacklistAccessToken, generateAccessToken } from '../services/token.service';
import { validateNPI } from '../services/npi.service';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendProviderApprovalNotification,
} from '../services/email.service';
import {
  getAdminUserByEmail,
  getAdminUserById,
  createAdminUser,
  verifyAdminEmail,
  updateAdminLoginSuccess,
  updateAdminLoginFailure,
  lockAdminAccount,
  updateAdminPassword,
  getProviderUserByEmail,
  getProviderUserById,
  getProviderUserByNpi,
  createProviderUser,
  verifyProviderEmail,
  approveProvider,
  rejectProvider,
  updateProviderLoginSuccess,
  updateProviderLoginFailure,
  lockProviderAccount,
  updateProviderPassword,
  getInstitutionByCode,
  getInstitutionById,
  createInstitution,
  deactivateInstitution,
  getApprovedDomainByDomain,
  createApprovedDomain,
  deactivateDomain,
  createEmailVerificationToken,
  getEmailVerificationToken,
  markEmailTokenUsed,
  createRefreshToken,
  getRefreshToken,
  revokeRefreshToken,
  createPasswordResetToken,
  getPasswordResetToken,
  markPasswordResetTokenUsed,
  createProviderApprovalRequest,
  getApprovalRequestById,
  updateApprovalRequest,
} from '../services/database';

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

export const Mutation: MutationResolvers<DataSourceContext> = {
  adminSignup: async (_parent, { input }, { pool }) => {
    const { email, password, firstName, lastName } = input;

    if (!isValidEmail(email)) {
      throw new Error('Invalid email format');
    }

    if (!isPrismClinicalEmail(email)) {
      throw new Error('Only @prism-clinical.com email addresses are allowed for admin signup');
    }

    const existingUser = await getAdminUserByEmail(pool, email);
    if (existingUser) {
      throw new Error('An account with this email already exists');
    }

    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      throw new Error(passwordValidation.errors.join('. '));
    }

    const passwordHash = await hashPassword(password);
    const user = await createAdminUser(pool, email, passwordHash, firstName, lastName);

    const verificationToken = generateToken(32);
    await createEmailVerificationToken(pool, user.id, 'ADMIN', verificationToken);
    await sendVerificationEmail(email, verificationToken, 'ADMIN', firstName);

    const tokenPair = await generateTokenPair(pool, {
      userId: user.id,
      email: user.email,
      userType: 'ADMIN',
      roles: [user.role],
    });

    return {
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        userType: 'ADMIN',
        roles: [user.role],
        status: user.status,
        emailVerified: user.email_verified,
      },
    };
  },

  providerSignup: async (_parent, { input }, { pool }) => {
    const { email, password, firstName, lastName, npi, institutionCode, role } = input;

    if (!isValidEmail(email)) {
      throw new Error('Invalid email format');
    }

    const emailDomain = getEmailDomain(email);
    const approvedDomain = await getApprovedDomainByDomain(pool, emailDomain);
    if (!approvedDomain) {
      throw new Error('Your email domain is not authorized. Please use an approved hospital or academic email.');
    }

    const existingUserByEmail = await getProviderUserByEmail(pool, email);
    if (existingUserByEmail) {
      throw new Error('An account with this email already exists');
    }

    const existingUserByNpi = await getProviderUserByNpi(pool, npi);
    if (existingUserByNpi) {
      throw new Error('An account with this NPI already exists');
    }

    const npiValidation = await validateNPI(npi);
    if (!npiValidation.isValid) {
      throw new Error(npiValidation.error || 'Invalid NPI');
    }

    const institution = await getInstitutionByCode(pool, institutionCode);
    if (!institution) {
      throw new Error('Invalid institution code');
    }

    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      throw new Error(passwordValidation.errors.join('. '));
    }

    const passwordHash = await hashPassword(password);
    const user = await createProviderUser(
      pool,
      email,
      passwordHash,
      firstName,
      lastName,
      npi,
      institution.id,
      role
    );

    const verificationToken = generateToken(32);
    await createEmailVerificationToken(pool, user.id, 'PROVIDER', verificationToken);
    await sendVerificationEmail(email, verificationToken, 'PROVIDER', firstName);

    return {
      success: true,
      message: 'Account created. Please check your email to verify your account.',
    };
  },

  login: async (_parent, { input }, { pool }) => {
    const { email, password, userType } = input;

    if (userType === 'ADMIN') {
      const user = await getAdminUserByEmail(pool, email);
      if (!user || !user.password_hash) {
        throw new Error('Invalid email or password');
      }

      if (user.locked_until && new Date() < user.locked_until) {
        throw new Error('Account is temporarily locked. Please try again later.');
      }

      const passwordValid = await verifyPassword(password, user.password_hash);
      if (!passwordValid) {
        const attempts = await updateAdminLoginFailure(pool, user.id);
        if (attempts >= MAX_LOGIN_ATTEMPTS) {
          await lockAdminAccount(pool, user.id, LOCK_DURATION_MINUTES);
          throw new Error('Too many failed attempts. Account locked for 15 minutes.');
        }
        throw new Error('Invalid email or password');
      }

      if (user.status !== 'ACTIVE') {
        throw new Error('Account is not active. Please verify your email or contact support.');
      }

      await updateAdminLoginSuccess(pool, user.id);

      const tokenPair = await generateTokenPair(pool, {
        userId: user.id,
        email: user.email,
        userType: 'ADMIN',
        roles: [user.role],
      });

      return {
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        expiresIn: tokenPair.expiresIn,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          userType: 'ADMIN',
          roles: [user.role],
          status: user.status,
          emailVerified: user.email_verified,
        },
      };
    } else {
      const user = await getProviderUserByEmail(pool, email);
      if (!user) {
        throw new Error('Invalid email or password');
      }

      if (user.locked_until && new Date() < user.locked_until) {
        throw new Error('Account is temporarily locked. Please try again later.');
      }

      const passwordValid = await verifyPassword(password, user.password_hash);
      if (!passwordValid) {
        const attempts = await updateProviderLoginFailure(pool, user.id);
        if (attempts >= MAX_LOGIN_ATTEMPTS) {
          await lockProviderAccount(pool, user.id, LOCK_DURATION_MINUTES);
          throw new Error('Too many failed attempts. Account locked for 15 minutes.');
        }
        throw new Error('Invalid email or password');
      }

      if (user.status === 'PENDING_VERIFICATION') {
        throw new Error('Please verify your email before logging in.');
      }

      if (user.status === 'PENDING_APPROVAL') {
        throw new Error('Your account is pending admin approval.');
      }

      if (user.status !== 'ACTIVE') {
        throw new Error('Account is not active. Please contact support.');
      }

      await updateProviderLoginSuccess(pool, user.id);

      const institution = user.institution_id ? await getInstitutionById(pool, user.institution_id) : null;

      const tokenPair = await generateTokenPair(pool, {
        userId: user.id,
        email: user.email,
        userType: 'PROVIDER',
        roles: [user.role],
        institutionId: institution?.id,
        providerId: user.id,
      });

      return {
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        expiresIn: tokenPair.expiresIn,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          userType: 'PROVIDER',
          roles: [user.role],
          institutionId: institution?.id,
          providerId: user.id,
          status: user.status,
          emailVerified: user.email_verified,
        },
      };
    }
  },

  logout: async (_parent, _args, { user, redis }) => {
    if (!user) {
      return true;
    }
    return true;
  },

  refreshToken: async (_parent, { input }, { pool }) => {
    const { refreshToken } = input;
    const tokenHash = hashToken(refreshToken);
    const storedToken = await getRefreshToken(pool, tokenHash);

    if (!storedToken) {
      throw new Error('Invalid refresh token');
    }

    if (new Date() > storedToken.expires_at) {
      await revokeRefreshToken(pool, tokenHash);
      throw new Error('Refresh token expired');
    }

    await revokeRefreshToken(pool, tokenHash);

    if (storedToken.user_type === 'ADMIN') {
      const user = await getAdminUserById(pool, storedToken.user_id);
      if (!user) {
        throw new Error('User not found');
      }

      const tokenPair = await generateTokenPair(pool, {
        userId: user.id,
        email: user.email,
        userType: 'ADMIN',
        roles: [user.role],
      });

      return {
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        expiresIn: tokenPair.expiresIn,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          userType: 'ADMIN',
          roles: [user.role],
          status: user.status,
          emailVerified: user.email_verified,
        },
      };
    } else {
      const user = await getProviderUserById(pool, storedToken.user_id);
      if (!user) {
        throw new Error('User not found');
      }

      const institution = user.institution_id ? await getInstitutionById(pool, user.institution_id) : null;

      const tokenPair = await generateTokenPair(pool, {
        userId: user.id,
        email: user.email,
        userType: 'PROVIDER',
        roles: [user.role],
        institutionId: institution?.id,
        providerId: user.id,
      });

      return {
        accessToken: tokenPair.accessToken,
        refreshToken: tokenPair.refreshToken,
        expiresIn: tokenPair.expiresIn,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          userType: 'PROVIDER',
          roles: [user.role],
          institutionId: institution?.id,
          providerId: user.id,
          status: user.status,
          emailVerified: user.email_verified,
        },
      };
    }
  },

  verifyEmail: async (_parent, { token }, { pool }) => {
    const tokenRecord = await getEmailVerificationToken(pool, token);

    if (!tokenRecord) {
      return { success: false, message: 'Invalid verification token' };
    }

    if (tokenRecord.used_at) {
      return { success: false, message: 'Token has already been used' };
    }

    if (new Date() > tokenRecord.expires_at) {
      return { success: false, message: 'Verification token has expired' };
    }

    await markEmailTokenUsed(pool, tokenRecord.id);

    if (tokenRecord.user_type === 'ADMIN') {
      await verifyAdminEmail(pool, tokenRecord.user_id);
    } else {
      await verifyProviderEmail(pool, tokenRecord.user_id);
      await createProviderApprovalRequest(pool, tokenRecord.user_id);
    }

    return { success: true, message: 'Email verified successfully' };
  },

  resendVerificationEmail: async (_parent, { email, userType }, { pool }) => {
    if (userType === 'ADMIN') {
      const user = await getAdminUserByEmail(pool, email);
      if (!user) {
        return { success: true, message: 'If an account exists, a verification email has been sent.' };
      }

      if (user.email_verified) {
        return { success: false, message: 'Email is already verified' };
      }

      const verificationToken = generateToken(32);
      await createEmailVerificationToken(pool, user.id, 'ADMIN', verificationToken);
      await sendVerificationEmail(email, verificationToken, 'ADMIN', user.first_name);
    } else {
      const user = await getProviderUserByEmail(pool, email);
      if (!user) {
        return { success: true, message: 'If an account exists, a verification email has been sent.' };
      }

      if (user.email_verified) {
        return { success: false, message: 'Email is already verified' };
      }

      const verificationToken = generateToken(32);
      await createEmailVerificationToken(pool, user.id, 'PROVIDER', verificationToken);
      await sendVerificationEmail(email, verificationToken, 'PROVIDER', user.first_name);
    }

    return { success: true, message: 'Verification email sent' };
  },

  requestPasswordReset: async (_parent, { input }, { pool }) => {
    const { email, userType } = input;

    if (userType === 'ADMIN') {
      const user = await getAdminUserByEmail(pool, email);
      if (user) {
        const resetToken = generateToken(32);
        await createPasswordResetToken(pool, user.id, 'ADMIN', resetToken);
        await sendPasswordResetEmail(email, resetToken, 'ADMIN', user.first_name);
      }
    } else {
      const user = await getProviderUserByEmail(pool, email);
      if (user) {
        const resetToken = generateToken(32);
        await createPasswordResetToken(pool, user.id, 'PROVIDER', resetToken);
        await sendPasswordResetEmail(email, resetToken, 'PROVIDER', user.first_name);
      }
    }

    return { success: true, message: 'If an account exists, a password reset email has been sent.' };
  },

  resetPassword: async (_parent, { input }, { pool }) => {
    const { token, newPassword } = input;

    const tokenRecord = await getPasswordResetToken(pool, token);

    if (!tokenRecord) {
      return { success: false, message: 'Invalid reset token' };
    }

    if (tokenRecord.used_at) {
      return { success: false, message: 'Token has already been used' };
    }

    if (new Date() > tokenRecord.expires_at) {
      return { success: false, message: 'Reset token has expired' };
    }

    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      return { success: false, message: passwordValidation.errors.join('. ') };
    }

    const passwordHash = await hashPassword(newPassword);
    await markPasswordResetTokenUsed(pool, tokenRecord.id);

    if (tokenRecord.user_type === 'ADMIN') {
      await updateAdminPassword(pool, tokenRecord.user_id, passwordHash);
    } else {
      await updateProviderPassword(pool, tokenRecord.user_id, passwordHash);
    }

    return { success: true, message: 'Password reset successfully' };
  },

  changePassword: async (_parent, { input }, { pool, user }) => {
    if (!user) {
      throw new Error('Authentication required');
    }

    const { currentPassword, newPassword } = input;

    const passwordValidation = validatePasswordStrength(newPassword);
    if (!passwordValidation.valid) {
      return { success: false, message: passwordValidation.errors.join('. ') };
    }

    if (user.userType === 'ADMIN') {
      const adminUser = await getAdminUserById(pool, user.id);
      if (!adminUser || !adminUser.password_hash) {
        return { success: false, message: 'User not found' };
      }

      const passwordValid = await verifyPassword(currentPassword, adminUser.password_hash);
      if (!passwordValid) {
        return { success: false, message: 'Current password is incorrect' };
      }

      const passwordHash = await hashPassword(newPassword);
      await updateAdminPassword(pool, user.id, passwordHash);
    } else {
      const providerUser = await getProviderUserById(pool, user.id);
      if (!providerUser) {
        return { success: false, message: 'User not found' };
      }

      const passwordValid = await verifyPassword(currentPassword, providerUser.password_hash);
      if (!passwordValid) {
        return { success: false, message: 'Current password is incorrect' };
      }

      const passwordHash = await hashPassword(newPassword);
      await updateProviderPassword(pool, user.id, passwordHash);
    }

    return { success: true, message: 'Password changed successfully' };
  },

  approveProvider: async (_parent, { input }, { pool, user }) => {
    if (!user || user.userType !== 'ADMIN') {
      throw new Error('Unauthorized: Admin access required');
    }

    const { requestId, approved, notes } = input;

    const request = await getApprovalRequestById(pool, requestId);
    if (!request) {
      return { success: false, message: 'Approval request not found' };
    }

    if (request.status !== 'PENDING') {
      return { success: false, message: 'This request has already been processed' };
    }

    const status = approved ? 'APPROVED' : 'REJECTED';
    await updateApprovalRequest(pool, requestId, status, user.id, notes || undefined);

    const providerUser = await getProviderUserById(pool, request.provider_user_id);
    if (!providerUser) {
      return { success: false, message: 'Provider user not found' };
    }

    if (approved) {
      await approveProvider(pool, providerUser.id);
    } else {
      await rejectProvider(pool, providerUser.id);
    }

    await sendProviderApprovalNotification(
      providerUser.email,
      providerUser.first_name,
      approved,
      notes || undefined
    );

    const institution = providerUser.institution_id
      ? await getInstitutionById(pool, providerUser.institution_id)
      : null;

    return {
      success: true,
      message: approved ? 'Provider approved successfully' : 'Provider rejected',
      providerUser: {
        id: providerUser.id,
        email: providerUser.email,
        firstName: providerUser.first_name,
        lastName: providerUser.last_name,
        npi: providerUser.npi,
        institution: institution ? {
          id: institution.id,
          name: institution.name,
          code: institution.code,
          domain: institution.domain,
          isActive: institution.is_active,
          createdAt: institution.created_at,
        } : null,
        role: providerUser.role as any,
        status: providerUser.status as any,
        emailVerified: providerUser.email_verified,
        npiVerified: providerUser.npi_verified,
        adminApproved: approved,
        lastLoginAt: providerUser.last_login_at,
        createdAt: providerUser.created_at,
        updatedAt: providerUser.updated_at,
      },
    };
  },

  createApprovedDomain: async (_parent, { input }, { pool, user }) => {
    if (!user || user.userType !== 'ADMIN') {
      throw new Error('Unauthorized: Admin access required');
    }

    const { domain, organizationName, domainType } = input;

    const existing = await getApprovedDomainByDomain(pool, domain);
    if (existing) {
      throw new Error('Domain already exists');
    }

    const newDomain = await createApprovedDomain(pool, domain, organizationName, domainType);

    return {
      id: newDomain.id,
      domain: newDomain.domain,
      organizationName: newDomain.organization_name,
      domainType: newDomain.domain_type as any,
      isActive: newDomain.is_active,
    };
  },

  deactivateDomain: async (_parent, { id }, { pool, user }) => {
    if (!user || user.userType !== 'ADMIN') {
      throw new Error('Unauthorized: Admin access required');
    }

    const domain = await deactivateDomain(pool, id);

    return {
      id: domain.id,
      domain: domain.domain,
      organizationName: domain.organization_name,
      domainType: domain.domain_type as any,
      isActive: domain.is_active,
    };
  },

  createAuthInstitution: async (_parent, { input }, { pool, user }) => {
    if (!user || user.userType !== 'ADMIN') {
      throw new Error('Unauthorized: Admin access required');
    }

    const { name, code, domain, addressStreet, addressCity, addressState, addressZip } = input;

    const existing = await getInstitutionByCode(pool, code);
    if (existing) {
      throw new Error('Institution code already exists');
    }

    const institution = await createInstitution(
      pool,
      name,
      code,
      domain || undefined,
      addressStreet || undefined,
      addressCity || undefined,
      addressState || undefined,
      addressZip || undefined
    );

    return {
      id: institution.id,
      name: institution.name,
      code: institution.code,
      domain: institution.domain,
      isActive: institution.is_active,
      createdAt: institution.created_at,
    };
  },

  deactivateAuthInstitution: async (_parent, { id }, { pool, user }) => {
    if (!user || user.userType !== 'ADMIN') {
      throw new Error('Unauthorized: Admin access required');
    }

    const institution = await deactivateInstitution(pool, id);

    return {
      id: institution.id,
      name: institution.name,
      code: institution.code,
      domain: institution.domain,
      isActive: institution.is_active,
      createdAt: institution.created_at,
    };
  },
};
