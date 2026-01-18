import { QueryResolvers } from '../__generated__/resolvers-types';
import { DataSourceContext } from '../types/DataSourceContext';
import { verifyAccessToken } from '../services/token.service';
import { validateNPI } from '../services/npi.service';
import {
  getApprovedDomainByDomain,
  getAllApprovedDomains,
  getAllInstitutions,
  getInstitutionById,
  getInstitutionByCode,
  getPendingApprovalRequests,
  getProviderUserById,
  getAdminUserById,
} from '../services/database';

export const Query: QueryResolvers<DataSourceContext> = {
  validateToken: async (_parent, { token }, { pool }) => {
    const decoded = verifyAccessToken(token);

    if (!decoded) {
      return {
        isValid: false,
        error: 'Invalid or expired token',
      };
    }

    return {
      isValid: true,
      user: {
        id: decoded.userId,
        email: decoded.email,
        firstName: '',
        lastName: '',
        userType: decoded.userType,
        roles: decoded.roles,
        institutionId: decoded.institutionId,
        providerId: decoded.providerId,
        status: 'ACTIVE',
        emailVerified: true,
      },
    };
  },

  me: async (_parent, _args, { user }) => {
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      userType: user.userType,
      roles: user.roles,
      institutionId: user.institutionId,
      providerId: user.providerId,
      status: user.status,
      emailVerified: user.emailVerified,
    };
  },

  pendingApprovals: async (_parent, { first, after }, { pool, user }) => {
    if (!user || user.userType !== 'ADMIN') {
      throw new Error('Unauthorized: Admin access required');
    }

    const limit = first || 20;
    const { rows, totalCount } = await getPendingApprovalRequests(pool, limit, after || undefined);

    const hasNextPage = rows.length > limit;
    const edges = rows.slice(0, limit).map((row) => ({
      cursor: row.id,
      node: {
        id: row.id,
        providerUser: {} as any,
        status: row.status as any,
        reviewedBy: row.reviewed_by ? {} as any : null,
        reviewedAt: row.reviewed_at,
        reviewNotes: row.review_notes,
        createdAt: row.created_at,
      },
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage,
        hasPreviousPage: !!after,
        startCursor: edges[0]?.cursor,
        endCursor: edges[edges.length - 1]?.cursor,
      },
      totalCount,
    };
  },

  approvedDomains: async (_parent, _args, { pool }) => {
    const domains = await getAllApprovedDomains(pool);
    return domains.map((d) => ({
      id: d.id,
      domain: d.domain,
      organizationName: d.organization_name,
      domainType: d.domain_type as any,
      isActive: d.is_active,
    }));
  },

  authInstitutions: async (_parent, _args, { pool }) => {
    const institutions = await getAllInstitutions(pool);
    return institutions.map((i) => ({
      id: i.id,
      name: i.name,
      code: i.code,
      domain: i.domain,
      isActive: i.is_active,
      createdAt: i.created_at,
    }));
  },

  authInstitution: async (_parent, { id }, { pool }) => {
    const inst = await getInstitutionById(pool, id);
    if (!inst) return null;
    return {
      id: inst.id,
      name: inst.name,
      code: inst.code,
      domain: inst.domain,
      isActive: inst.is_active,
      createdAt: inst.created_at,
    };
  },

  authInstitutionByCode: async (_parent, { code }, { pool }) => {
    const inst = await getInstitutionByCode(pool, code);
    if (!inst) return null;
    return {
      id: inst.id,
      name: inst.name,
      code: inst.code,
      domain: inst.domain,
      isActive: inst.is_active,
      createdAt: inst.created_at,
    };
  },

  validateNPI: async (_parent, { npi }) => {
    const result = await validateNPI(npi);
    return {
      isValid: result.isValid,
      providerName: result.providerName,
      specialty: result.specialty,
      error: result.error,
    };
  },

  isApprovedDomain: async (_parent, { domain }, { pool }) => {
    const approvedDomain = await getApprovedDomainByDomain(pool, domain);
    return !!approvedDomain;
  },
};
