import { Resolvers, MutationSubmitTranscriptionArgs, MutationCancelTranscriptionArgs, MutationRetryTranscriptionArgs } from "../__generated__/resolvers-types";
import { transcriptionService } from "../services/database";
import { addTranscriptionJob, cancelJob } from "../services/transcription-queue";
import { GraphQLError } from "graphql";

export const Mutation: Resolvers = {
  Mutation: {
    async submitTranscription(
      _parent,
      { input }: MutationSubmitTranscriptionArgs,
      _context
    ) {
      if (!input.patientId) {
        throw new GraphQLError("Patient ID is required.");
      }
      if (!input.audioUri) {
        throw new GraphQLError("Audio URI is required.");
      }

      // Validate audioUri is a valid URI format (not arbitrary content)
      try {
        new URL(input.audioUri);
      } catch {
        // Also allow gs:// and s3:// URIs
        if (!input.audioUri.startsWith('gs://') && !input.audioUri.startsWith('s3://')) {
          throw new GraphQLError("Audio URI must be a valid URL or cloud storage URI.");
        }
      }

      try {
        const transcription = await transcriptionService.submitTranscription({
          patientId: input.patientId,
          encounterId: input.encounterId || undefined,
          audioUri: input.audioUri,
          speakerCount: input.speakerCount || undefined,
          vocabularyHints: input.vocabularyHints || undefined,
          createdBy: 'system', // TODO: Get from auth context
        });

        // Add job to BullMQ queue for async processing
        await addTranscriptionJob({
          transcriptionId: transcription.id,
          patientId: input.patientId,
          encounterId: input.encounterId || undefined,
          audioUri: input.audioUri,
          speakerCount: input.speakerCount || undefined,
          vocabularyHints: input.vocabularyHints || undefined,
        });

        return {
          ...transcription,
          patient: { __typename: 'Patient' as const, id: transcription.patientId },
          entities: [] as any[],
        } as any;
      } catch (error: any) {
        if (error.message.includes('Foreign key constraint')) {
          throw new GraphQLError("Invalid patient reference.");
        }
        throw new GraphQLError("Failed to submit transcription.");
      }
    },

    async cancelTranscription(
      _parent,
      { id }: MutationCancelTranscriptionArgs,
      _context
    ) {
      if (!id) {
        throw new GraphQLError("Transcription ID is required.");
      }

      try {
        // Try to cancel the queue job first (only works if not yet processing)
        await cancelJob(id);

        const transcription = await transcriptionService.cancelTranscription(id);
        if (!transcription) {
          throw new GraphQLError(
            "Transcription not found or cannot be cancelled (only PENDING or PROCESSING transcriptions can be cancelled)."
          );
        }

        return {
          ...transcription,
          patient: { __typename: 'Patient' as const, id: transcription.patientId },
          entities: [] as any[],
        } as any;
      } catch (error: any) {
        if (error.extensions?.code === 'NOT_FOUND') {
          throw error;
        }
        throw new GraphQLError("Failed to cancel transcription.");
      }
    },

    async retryTranscription(
      _parent,
      { id }: MutationRetryTranscriptionArgs,
      _context
    ) {
      if (!id) {
        throw new GraphQLError("Transcription ID is required.");
      }

      try {
        const transcription = await transcriptionService.retryTranscription(id);
        if (!transcription) {
          throw new GraphQLError(
            "Transcription not found or cannot be retried (only FAILED transcriptions can be retried)."
          );
        }

        // Add job back to queue for retry
        await addTranscriptionJob({
          transcriptionId: transcription.id,
          patientId: transcription.patientId,
          encounterId: transcription.encounterId,
          audioUri: transcription.audioUri,
        });

        return {
          ...transcription,
          patient: { __typename: 'Patient' as const, id: transcription.patientId },
          entities: [] as any[],
        } as any;
      } catch (error: any) {
        if (error.extensions?.code === 'NOT_FOUND') {
          throw error;
        }
        throw new GraphQLError("Failed to retry transcription.");
      }
    },
  },
};
