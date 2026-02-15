import { GraphQLError } from 'graphql';
import { GraphQLResolveInfo } from 'graphql';
import { visitService } from '../../services/database';
import { getStorageService } from '../../services/storage';
import { DataSourceContext } from '../../types/DataSourceContext';
import {
  MutationRequestAudioUploadUrlArgs,
  MutationUpdateVisitAudioArgs,
  ResolversTypes,
} from '../../__generated__/resolvers-types';

function requireAuth(context: DataSourceContext): void {
  if (!context.auth) {
    throw new GraphQLError('Authentication required', {
      extensions: { code: 'UNAUTHENTICATED' },
    });
  }
}

function getStorage() {
  try {
    return getStorageService();
  } catch {
    throw new GraphQLError('Audio upload is not configured on this server', {
      extensions: { code: 'SERVICE_UNAVAILABLE' },
    });
  }
}

export const audioUploadResolvers = {
  requestAudioUploadUrl: async (
    _parent: {},
    { visitId, contentType }: MutationRequestAudioUploadUrlArgs,
    context: DataSourceContext,
    _info: GraphQLResolveInfo,
  ): Promise<ResolversTypes['AudioUploadUrl']> => {
    requireAuth(context);

    const visit = await visitService.getVisitById(visitId);
    if (!visit) {
      throw new GraphQLError('Visit not found', {
        extensions: { code: 'NOT_FOUND' },
      });
    }

    if (visit.status === 'COMPLETED' || visit.status === 'CANCELLED') {
      throw new GraphQLError('Cannot upload audio for a completed or cancelled visit', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    const storageService = getStorage();
    return storageService.generateSignedUploadUrl(
      visitId,
      contentType || 'audio/webm',
    );
  },

  updateVisitAudio: async (
    _parent: {},
    { visitId, audioUri }: MutationUpdateVisitAudioArgs,
    context: DataSourceContext,
    _info: GraphQLResolveInfo,
  ): Promise<ResolversTypes['Visit']> => {
    requireAuth(context);

    const visit = await visitService.getVisitById(visitId);
    if (!visit) {
      throw new GraphQLError('Visit not found', {
        extensions: { code: 'NOT_FOUND' },
      });
    }

    // Verify the file actually exists in GCS before persisting
    const storageService = getStorage();
    const exists = await storageService.verifyFileExists(audioUri);
    if (!exists) {
      throw new GraphQLError('Audio file not found at the specified URI', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    const updated = await visitService.updateVisitAudioUri(visitId, audioUri);
    if (!updated) {
      throw new GraphQLError('Failed to update visit audio URI', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }

    // DB Visit enum values (SCHEDULED) differ from generated types (Scheduled)
    // but resolve correctly at the GraphQL layer
    return updated as unknown as ResolversTypes['Visit'];
  },
};
