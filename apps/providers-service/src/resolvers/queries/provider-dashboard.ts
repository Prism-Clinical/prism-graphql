/**
 * Provider Dashboard Query Resolvers
 *
 * Queries for the provider dashboard with visit insights.
 */

import { GraphQLError } from 'graphql';
import { visitService, providerService } from '../../services/database';

/**
 * Context for resolvers
 */
interface ResolverContext {
  userId: string;
  userRole: string;
  carePlanService: {
    getActiveCarePlanForPatient: (patientId: string) => Promise<any>;
    getPendingRecommendationsForVisit: (visitId: string) => Promise<any[]>;
    getRedFlagsForVisit: (visitId: string) => Promise<any[]>;
  };
  auditLogger: {
    logAccess: (entry: any) => Promise<void>;
  };
}

/**
 * Visit with insights type
 */
interface VisitWithInsights {
  visit: any;
  patient: any;
  hasActiveCarePlan: boolean;
  recommendationCount: number;
  redFlagCount: number;
}

/**
 * Provider dashboard type
 */
interface ProviderDashboard {
  provider: any;
  todaysVisits: VisitWithInsights[];
  pendingCarePlans: number;
  completedCarePlans: number;
}

/**
 * Get provider dashboard data
 */
export async function providerDashboard(
  _parent: unknown,
  args: { providerId: string; date: string },
  context: ResolverContext
): Promise<ProviderDashboard> {
  const { providerId, date } = args;
  const startTime = Date.now();

  // Validate authentication
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  // Validate user role
  const allowedRoles = ['PROVIDER', 'CARE_COORDINATOR', 'ADMIN'];
  if (!allowedRoles.includes(context.userRole)) {
    throw new GraphQLError('Insufficient permissions', {
      extensions: { code: 'FORBIDDEN' },
    });
  }

  // TODO: In production, verify user is this provider or has admin access
  // if (context.userId !== providerId && context.userRole !== 'ADMIN') {
  //   throw new GraphQLError('Access denied', {
  //     extensions: { code: 'FORBIDDEN' },
  //   });
  // }

  try {
    // Parse date
    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) {
      throw new GraphQLError('Invalid date format', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    // Get provider
    const provider = await providerService.getProviderById(providerId);
    if (!provider) {
      throw new GraphQLError('Provider not found', {
        extensions: { code: 'NOT_FOUND' },
      });
    }

    // Get visits for the day
    const visits = await visitService.getVisitsForProviderOnDate(providerId, targetDate);

    // Get insights for each visit (in parallel using DataLoader pattern)
    const visitsWithInsights: VisitWithInsights[] = await Promise.all(
      visits.map(async (visit: any) => {
        const [hasActiveCarePlan, recommendations, redFlags] = await Promise.all([
          context.carePlanService
            .getActiveCarePlanForPatient(visit.patientId)
            .then((cp) => !!cp)
            .catch(() => false),
          context.carePlanService
            .getPendingRecommendationsForVisit(visit.id)
            .catch(() => []),
          context.carePlanService
            .getRedFlagsForVisit(visit.id)
            .catch(() => []),
        ]);

        // Log PHI access for each patient
        await context.auditLogger.logAccess({
          eventType: 'PHI_ACCESS',
          userId: context.userId,
          userRole: context.userRole,
          patientId: visit.patientId,
          resourceType: 'dashboard_visit',
          action: 'READ',
          outcome: 'SUCCESS',
        });

        return {
          visit: {
            id: visit.id,
            patientId: visit.patientId,
            type: visit.type,
            status: visit.status,
            scheduledAt: visit.scheduledAt,
            startedAt: visit.startedAt,
            completedAt: visit.completedAt,
            chiefComplaint: visit.chiefComplaint,
          },
          patient: {
            id: visit.patientId,
            // Note: Patient details would come from patient service via federation
          },
          hasActiveCarePlan,
          recommendationCount: recommendations.length,
          redFlagCount: redFlags.length,
        };
      })
    );

    // Calculate pending and completed care plans
    const pendingCarePlans = visitsWithInsights.filter(
      (v) => !v.hasActiveCarePlan && v.recommendationCount > 0
    ).length;

    const completedCarePlans = visitsWithInsights.filter(
      (v) => v.hasActiveCarePlan
    ).length;

    // Check performance
    const duration = Date.now() - startTime;
    if (duration > 500) {
      console.warn(`Provider dashboard query took ${duration}ms`);
    }

    return {
      provider: {
        id: provider.id,
        npi: provider.npi,
        firstName: provider.firstName,
        lastName: provider.lastName,
        specialty: provider.specialty,
        credentials: provider.credentials,
      },
      todaysVisits: visitsWithInsights,
      pendingCarePlans,
      completedCarePlans,
    };
  } catch (error) {
    if (error instanceof GraphQLError) throw error;

    console.error('Dashboard query error:', error);
    throw new GraphQLError('Failed to load dashboard', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }
}

/**
 * Get visits for provider with care plan status
 */
export async function visitsWithCarePlanStatus(
  _parent: unknown,
  args: {
    providerId: string;
    startDate: string;
    endDate: string;
    status?: string;
  },
  context: ResolverContext
): Promise<VisitWithInsights[]> {
  const { providerId, startDate, endDate, status } = args;

  // Validate authentication
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  try {
    // Get visits in date range
    const visits = await visitService.getVisitsForProviderInRange(
      providerId,
      new Date(startDate),
      new Date(endDate),
      status
    );

    // Get insights for each visit
    const visitsWithInsights: VisitWithInsights[] = await Promise.all(
      visits.map(async (visit: any) => {
        const [hasActiveCarePlan, recommendations, redFlags] = await Promise.all([
          context.carePlanService
            .getActiveCarePlanForPatient(visit.patientId)
            .then((cp) => !!cp)
            .catch(() => false),
          context.carePlanService
            .getPendingRecommendationsForVisit(visit.id)
            .catch(() => []),
          context.carePlanService
            .getRedFlagsForVisit(visit.id)
            .catch(() => []),
        ]);

        return {
          visit,
          patient: { id: visit.patientId },
          hasActiveCarePlan,
          recommendationCount: recommendations.length,
          redFlagCount: redFlags.length,
        };
      })
    );

    return visitsWithInsights;
  } catch (error) {
    console.error('Visits with status query error:', error);
    throw new GraphQLError('Failed to load visits', {
      extensions: { code: 'INTERNAL_SERVER_ERROR' },
    });
  }
}

/**
 * Get provider care plan statistics
 */
export async function providerCarePlanStats(
  _parent: unknown,
  args: { providerId: string; days?: number },
  context: ResolverContext
): Promise<{
  totalCarePlansCreated: number;
  averageTimeToCreate: number;
  recommendationAcceptanceRate: number;
  mostCommonConditions: Array<{ code: string; count: number }>;
}> {
  const { providerId, days = 30 } = args;

  // Validate authentication
  if (!context.userId) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }

  // TODO: Implement with actual care plan statistics
  // This would query the care_plans table for provider stats

  return {
    totalCarePlansCreated: 0,
    averageTimeToCreate: 0,
    recommendationAcceptanceRate: 0,
    mostCommonConditions: [],
  };
}
