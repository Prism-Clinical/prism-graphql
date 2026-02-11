/**
 * Generation Progress Subscription
 *
 * Handles the carePlanGenerationProgress subscription.
 */

import { GraphQLError } from 'graphql';
import { Redis } from 'ioredis';

/**
 * Context for the subscription
 */
export interface SubscriptionContext {
  userId: string;
  userRole: string;
  redis: Redis;
  auditLogger: {
    logAccess: (entry: any) => Promise<void>;
  };
}

/**
 * Progress message structure
 */
export interface ProgressMessage {
  requestId: string;
  stage: string;
  status: string;
  message?: string;
  partialResult?: any;
  timestamp: string;
}

/**
 * Create async iterator for progress updates
 */
async function* createProgressIterator(
  requestId: string,
  context: SubscriptionContext
): AsyncGenerator<{ carePlanGenerationProgress: ProgressMessage }> {
  const channelName = `pipeline:progress:${requestId}`;
  const subscriber = context.redis.duplicate();

  // Track subscription state
  let isComplete = false;
  const messageQueue: ProgressMessage[] = [];
  let resolveNext: ((value: ProgressMessage) => void) | null = null;

  // Set up message handler
  subscriber.on('message', (channel, message) => {
    if (channel !== channelName) return;

    try {
      const parsed = JSON.parse(message) as ProgressMessage;

      // Check if this is a completion message
      if (parsed.status === 'COMPLETED' || parsed.status === 'FAILED') {
        isComplete = true;
      }

      // Either resolve waiting promise or queue the message
      if (resolveNext) {
        resolveNext(parsed);
        resolveNext = null;
      } else {
        messageQueue.push(parsed);
      }
    } catch (err) {
      console.error('Failed to parse progress message:', err);
    }
  });

  // Subscribe to channel
  await subscriber.subscribe(channelName);

  try {
    // Yield messages until complete
    while (!isComplete) {
      let message: ProgressMessage;

      if (messageQueue.length > 0) {
        message = messageQueue.shift()!;
      } else {
        // Wait for next message with timeout
        message = await Promise.race([
          new Promise<ProgressMessage>((resolve) => {
            resolveNext = resolve;
          }),
          new Promise<ProgressMessage>((_, reject) => {
            setTimeout(() => reject(new Error('Subscription timeout')), 300000); // 5 min timeout
          }),
        ]);
      }

      yield { carePlanGenerationProgress: message };

      // Exit if complete
      if (message.status === 'COMPLETED' || message.status === 'FAILED') {
        break;
      }
    }
  } finally {
    // Clean up subscription
    await subscriber.unsubscribe(channelName);
    subscriber.disconnect();
  }
}

/**
 * Progress subscription resolver
 */
export const carePlanGenerationProgressSubscription = {
  subscribe: async (
    _parent: unknown,
    args: { requestId: string },
    context: SubscriptionContext
  ) => {
    const { requestId } = args;

    // Validate user is authenticated
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

    // Validate requestId format
    if (!requestId || !/^[a-f0-9-]{36}$/.test(requestId)) {
      throw new GraphQLError('Invalid requestId format', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }

    // TODO: In production, verify user has access to this request
    // const request = await getPipelineRequest(requestId);
    // if (!request || request.userId !== context.userId) {
    //   throw new GraphQLError('Request not found or access denied', {
    //     extensions: { code: 'NOT_FOUND' },
    //   });
    // }

    // Log subscription access
    await context.auditLogger.logAccess({
      eventType: 'SUBSCRIPTION_START',
      userId: context.userId,
      userRole: context.userRole,
      resourceType: 'pipeline_progress',
      resourceId: requestId,
      action: 'READ',
      outcome: 'SUCCESS',
    });

    // Return async iterator
    return createProgressIterator(requestId, context);
  },
};

/**
 * Emit progress update to subscribers
 */
export async function emitProgressUpdate(
  redis: Redis,
  requestId: string,
  progress: Omit<ProgressMessage, 'requestId' | 'timestamp'>
): Promise<void> {
  const channelName = `pipeline:progress:${requestId}`;

  const message: ProgressMessage = {
    requestId,
    ...progress,
    timestamp: new Date().toISOString(),
  };

  await redis.publish(channelName, JSON.stringify(message));
}

/**
 * Progress emitter class for use in pipeline
 */
export class ProgressEmitter {
  private redis: Redis;
  private requestId: string;

  constructor(redis: Redis, requestId: string) {
    this.redis = redis;
    this.requestId = requestId;
  }

  /**
   * Emit stage start
   */
  async stageStarted(stage: string): Promise<void> {
    await emitProgressUpdate(this.redis, this.requestId, {
      stage,
      status: 'IN_PROGRESS',
      message: `Starting ${stage}...`,
    });
  }

  /**
   * Emit stage completion
   */
  async stageCompleted(stage: string, message?: string): Promise<void> {
    await emitProgressUpdate(this.redis, this.requestId, {
      stage,
      status: 'COMPLETED',
      message: message ?? `Completed ${stage}`,
    });
  }

  /**
   * Emit stage failure
   */
  async stageFailed(stage: string, error: string): Promise<void> {
    await emitProgressUpdate(this.redis, this.requestId, {
      stage,
      status: 'FAILED',
      message: error,
    });
  }

  /**
   * Emit stage skipped
   */
  async stageSkipped(stage: string, reason: string): Promise<void> {
    await emitProgressUpdate(this.redis, this.requestId, {
      stage,
      status: 'SKIPPED',
      message: reason,
    });
  }

  /**
   * Emit pipeline completion
   */
  async pipelineCompleted(partialResult?: any): Promise<void> {
    await emitProgressUpdate(this.redis, this.requestId, {
      stage: 'COMPLETE',
      status: 'COMPLETED',
      message: 'Pipeline completed successfully',
      partialResult,
    });
  }

  /**
   * Emit pipeline failure
   */
  async pipelineFailed(error: string): Promise<void> {
    await emitProgressUpdate(this.redis, this.requestId, {
      stage: 'ERROR',
      status: 'FAILED',
      message: error,
    });
  }
}
