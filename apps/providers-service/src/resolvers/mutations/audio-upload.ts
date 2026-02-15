import { GraphQLError } from 'graphql';
import { visitService } from '../../services/database';
import { getStorageService } from '../../services/storage';

export const audioUploadResolvers = {
  getAudioUploadUrl: async (
    _parent: unknown,
    { visitId, contentType }: { visitId: string; contentType?: string },
  ) => {
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

    const storageService = getStorageService();
    const result = await storageService.generateSignedUploadUrl(
      visitId,
      contentType || 'audio/webm',
    );

    return result;
  },

  updateVisitAudio: async (
    _parent: unknown,
    { visitId, audioUri }: { visitId: string; audioUri: string },
  ) => {
    const visit = await visitService.getVisitById(visitId);
    if (!visit) {
      throw new GraphQLError('Visit not found', {
        extensions: { code: 'NOT_FOUND' },
      });
    }

    const updated = await visitService.updateVisitAudioUri(visitId, audioUri);
    if (!updated) {
      throw new GraphQLError('Failed to update visit audio URI', {
        extensions: { code: 'INTERNAL_SERVER_ERROR' },
      });
    }

    return updated;
  },
};
