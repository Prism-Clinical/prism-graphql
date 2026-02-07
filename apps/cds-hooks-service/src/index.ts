import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { discoveryRouter } from './routes';
import { patientViewRouter } from './handlers';
import { getConfig } from './config';
import type { CDSErrorResponse } from './types';

const app = express();
const config = getConfig();

// Parse JSON bodies
app.use(express.json());

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
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
};

app.use(cors(corsOptions));

// Health check endpoint for Kubernetes liveness probes
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    service: 'cds-hooks-service',
    timestamp: new Date().toISOString(),
  });
});

// Readiness check endpoint for Kubernetes readiness probes
app.get('/ready', (_req: Request, res: Response) => {
  // TODO: Add checks for dependent services (ML service, FHIR server)
  res.status(200).json({
    status: 'ready',
    service: 'cds-hooks-service',
    timestamp: new Date().toISOString(),
  });
});

// CDS Hooks Discovery endpoint
app.use('/cds-services', discoveryRouter);

// CDS Hooks Service endpoints
app.use('/cds-services/prism-patient-view', patientViewRouter);

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
  console.error('Unhandled error:', err);

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
    console.log(`🚀 CDS Hooks Service started on port ${config.port}`);
    console.log(`📋 Discovery endpoint: http://localhost:${config.port}/cds-services`);
    console.log(`❤️  Health check: http://localhost:${config.port}/health`);
  });
}

// Only start if not in test mode
if (process.env.NODE_ENV !== 'test') {
  start();
}

export { app };
