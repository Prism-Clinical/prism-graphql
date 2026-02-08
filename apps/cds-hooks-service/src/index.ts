import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { discoveryRouter } from './routes';
import { patientViewRouter, orderReviewRouter, medicationPrescribeRouter } from './handlers';
import { getConfig } from './config';
import { checkHealth, checkReadiness } from './services/health';
import { logger, requestLogger, logStartup, logError } from './utils/logger';
import { getMetrics, recordRequest } from './utils/metrics';
import {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_HEALTH_MAX_REQUESTS,
} from './constants';
import type { CDSErrorResponse } from './types';

const app = express();
const config = getConfig();

// Parse JSON bodies
app.use(express.json());

// Request logging middleware
app.use(requestLogger());

// CORS configuration for EHR iframe embedding
// Per CDS Hooks spec, EHRs may embed CDS responses in iframes
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Check if origin is in allowed list, or allow all if wildcard
    if (config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn({ origin, allowedOrigins: config.allowedOrigins }, 'CORS origin rejected');
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
};

app.use(cors(corsOptions));

// Rate limiting for CDS service endpoints
const cdsRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS,
  message: {
    error: 'rate_limit_exceeded',
    message: 'Too many requests. Please try again later.',
  } as CDSErrorResponse,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Use X-Forwarded-For if behind proxy, otherwise use IP
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0]?.trim() ?? req.ip ?? 'unknown';
    }
    return req.ip ?? 'unknown';
  },
  handler: (req: Request, res: Response) => {
    logger.warn(
      { ip: req.ip, path: req.path },
      'Rate limit exceeded'
    );
    res.status(429).json({
      error: 'rate_limit_exceeded',
      message: 'Too many requests. Please try again later.',
    } as CDSErrorResponse);
  },
});

// Higher rate limit for health endpoints
const healthRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_HEALTH_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
});

// Health check endpoint for Kubernetes liveness probes
app.get('/health', healthRateLimiter, async (_req: Request, res: Response) => {
  const health = await checkHealth();
  res.status(health.status === 'healthy' ? 200 : 503).json(health);
});

// Readiness check endpoint for Kubernetes readiness probes
app.get('/ready', healthRateLimiter, async (_req: Request, res: Response) => {
  const readiness = await checkReadiness();
  res.status(readiness.status === 'ready' ? 200 : 503).json(readiness);
});

// Metrics endpoint
app.get('/metrics', healthRateLimiter, (_req: Request, res: Response) => {
  res.status(200).json(getMetrics());
});

// CDS Hooks Discovery endpoint
app.use('/cds-services', cdsRateLimiter, discoveryRouter);

// CDS Hooks Service endpoints with rate limiting and request tracking
app.use('/cds-services/prism-patient-view', cdsRateLimiter, (req, res, next) => {
  recordRequest('patient-view');
  next();
}, patientViewRouter);

app.use('/cds-services/prism-order-review', cdsRateLimiter, (req, res, next) => {
  recordRequest('order-review');
  next();
}, orderReviewRouter);

app.use('/cds-services/prism-medication-prescribe', cdsRateLimiter, (req, res, next) => {
  recordRequest('medication-prescribe');
  next();
}, medicationPrescribeRouter);

// 404 handler for unknown routes
app.use((_req: Request, res: Response) => {
  const response: CDSErrorResponse = {
    error: 'not_found',
    message: 'The requested resource was not found',
  };
  res.status(404).json(response);
});

// Global error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logError(err);

  const response: CDSErrorResponse = {
    error: 'internal_error',
    message: 'An internal server error occurred',
    details: process.env.NODE_ENV === 'development' ? [err.message] : undefined,
  };
  res.status(500).json(response);
});

// Start server
function start(): void {
  app.listen(config.port, () => {
    logStartup(config.port);
    logger.info(`Discovery endpoint: http://localhost:${config.port}/cds-services`);
    logger.info(`Health check: http://localhost:${config.port}/health`);
    logger.info(`Metrics: http://localhost:${config.port}/metrics`);
  });
}

// Only start if not in test mode
if (process.env.NODE_ENV !== 'test') {
  start();
}

export { app };
