import { Router, Request, Response } from 'express';
import { cdsServices } from '../config/services';
import type { CDSDiscoveryResponse } from '../types';

const router = Router();

/**
 * GET /cds-services
 *
 * CDS Hooks Discovery Endpoint
 *
 * Returns a list of CDS services available from this endpoint.
 * Per CDS Hooks 2.0 specification, this endpoint:
 * - Returns a JSON object with a 'services' array
 * - Each service includes id, hook, title, description, and optional prefetch templates
 * - EHRs use this to discover available CDS services
 *
 * @see https://cds-hooks.hl7.org/2.0/#discovery
 */
router.get('/', (_req: Request, res: Response) => {
  const response: CDSDiscoveryResponse = {
    services: cdsServices,
  };

  res.status(200).json(response);
});

/**
 * GET /cds-services/:serviceId
 *
 * Get details for a specific CDS service
 *
 * Returns the service definition for a specific service ID.
 * Returns 404 if the service is not found.
 */
router.get('/:serviceId', (req: Request, res: Response) => {
  const { serviceId } = req.params;
  const service = cdsServices.find(s => s.id === serviceId);

  if (!service) {
    res.status(404).json({
      error: 'not_found',
      message: `CDS service '${serviceId}' not found`,
    });
    return;
  }

  res.status(200).json(service);
});

export default router;
