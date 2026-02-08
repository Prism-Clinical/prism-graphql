import pino, { Logger as PinoLogger, LoggerOptions } from 'pino';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Logger context for CDS Hooks requests
 */
export interface CDSLogContext {
  hookInstance?: string;
  patientId?: string;
  userId?: string;
  serviceId?: string;
  encounterId?: string;
  requestId?: string;
}

/**
 * Create a configured Pino logger instance
 */
function createLogger(): PinoLogger {
  const options: LoggerOptions = {
    name: 'cds-hooks-service',
    level: process.env.LOG_LEVEL ?? 'info',
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  // In development, use prettier formatting
  if (process.env.NODE_ENV === 'development') {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  // In production/test, use JSON format
  return pino(options);
}

/**
 * Main logger instance
 */
export const logger = createLogger();

/**
 * Create a child logger with CDS context
 */
export function createContextLogger(context: CDSLogContext): PinoLogger {
  return logger.child(context);
}

/**
 * Extract CDS context from request body
 */
function extractCDSContext(body: unknown): CDSLogContext {
  const context: CDSLogContext = {};

  if (body && typeof body === 'object') {
    const request = body as Record<string, unknown>;

    if (typeof request.hookInstance === 'string') {
      context.hookInstance = request.hookInstance;
    }

    if (request.context && typeof request.context === 'object') {
      const ctx = request.context as Record<string, unknown>;

      if (typeof ctx.patientId === 'string') {
        context.patientId = ctx.patientId;
      }
      if (typeof ctx.userId === 'string') {
        context.userId = ctx.userId;
      }
      if (typeof ctx.encounterId === 'string') {
        context.encounterId = ctx.encounterId;
      }
    }
  }

  return context;
}

/**
 * Express middleware for request logging
 *
 * Logs incoming requests and responses with CDS context
 */
export function requestLogger(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();
    const requestId = req.headers['x-request-id'] as string | undefined;

    // Extract CDS context from request body
    const cdsContext = extractCDSContext(req.body);

    // Create request-scoped logger
    const reqLogger = logger.child({
      ...cdsContext,
      requestId,
      method: req.method,
      path: req.path,
    });

    // Log incoming request
    reqLogger.info('Incoming request');

    // Attach logger to request for use in handlers
    (req as unknown as { log: PinoLogger }).log = reqLogger;

    // Log response on finish
    res.on('finish', () => {
      const duration = Date.now() - startTime;

      reqLogger.info(
        {
          statusCode: res.statusCode,
          duration,
        },
        'Request completed'
      );
    });

    next();
  };
}

/**
 * Log hook request processing
 */
export function logHookRequest(
  serviceId: string,
  hookInstance: string,
  patientId?: string
): void {
  logger.info(
    {
      serviceId,
      hookInstance,
      patientId,
    },
    'Processing CDS hook request'
  );
}

/**
 * Log card generation
 */
export function logCardGenerated(
  serviceId: string,
  cardCount: number,
  indicators: { critical: number; warning: number; info: number }
): void {
  logger.info(
    {
      serviceId,
      cardCount,
      ...indicators,
    },
    'Generated CDS cards'
  );
}

/**
 * Log FHIR fetch operation
 */
export function logFHIRFetch(
  resourceUrl: string,
  success: boolean,
  duration: number,
  error?: string
): void {
  if (success) {
    logger.debug(
      {
        resourceUrl,
        duration,
      },
      'FHIR fetch completed'
    );
  } else {
    logger.warn(
      {
        resourceUrl,
        duration,
        error,
      },
      'FHIR fetch failed'
    );
  }
}

/**
 * Log service startup
 */
export function logStartup(port: number): void {
  logger.info(
    {
      port,
      nodeEnv: process.env.NODE_ENV ?? 'development',
    },
    'CDS Hooks Service started'
  );
}

/**
 * Log validation errors
 */
export function logValidationError(
  path: string,
  errors: string[],
  hookInstance?: string
): void {
  logger.warn(
    {
      path,
      errors,
      hookInstance,
    },
    'Request validation failed'
  );
}

/**
 * Log unhandled errors
 */
export function logError(error: Error, context?: Record<string, unknown>): void {
  logger.error(
    {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      ...context,
    },
    'Unhandled error'
  );
}

export type { PinoLogger as Logger };
