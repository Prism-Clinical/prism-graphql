/**
 * Phase 3 commit 3: project a single-pathway resolution into a ResolvedCarePlan.
 *
 * The traversal engine produces a `ResolutionState` keyed by node id. For
 * multi-pathway merging we need to flatten that state into the role-typed
 * shapes the merge layer expects (medications, labs, procedures, schedules,
 * quality metrics). This module does that, pulling type-specific properties
 * straight off the carried `node.properties` payload — the same approach the
 * single-pathway care-plan-generator uses.
 *
 * Pure function. No DB. The caller passes in pathway metadata (logical id +
 * title) since the ResolutionState alone doesn't carry it.
 */

import {
  NodeResult,
  NodeStatus,
  ResolutionState,
} from './types';
import {
  ResolvedCarePlan,
  ResolvedMedication,
  ResolvedLab,
  ResolvedProcedure,
  ResolvedSchedule,
  ResolvedQualityMetric,
} from './care-plan-merge';
import { MedicationRole } from '../import/types';

export interface PathwayProjectionMetadata {
  pathwayId: string;
  pathwayLogicalId: string;
  pathwayTitle: string;
}

export function projectResolutionToCarePlan(
  resolutionState: ResolutionState,
  meta: PathwayProjectionMetadata,
): ResolvedCarePlan {
  const medications: ResolvedMedication[] = [];
  const labs: ResolvedLab[] = [];
  const procedures: ResolvedProcedure[] = [];
  const schedules: ResolvedSchedule[] = [];
  const qualityMetrics: ResolvedQualityMetric[] = [];

  for (const node of resolutionState.values()) {
    if (node.status !== NodeStatus.INCLUDED) continue;

    switch (node.nodeType) {
      case 'Medication': {
        const med = projectMedication(node, meta.pathwayId);
        if (med) medications.push(med);
        break;
      }
      case 'LabTest': {
        const lab = projectLab(node, meta.pathwayId);
        if (lab) labs.push(lab);
        break;
      }
      case 'Procedure': {
        const proc = projectProcedure(node, meta.pathwayId);
        if (proc) procedures.push(proc);
        break;
      }
      case 'Schedule': {
        const sched = projectSchedule(node, meta.pathwayId);
        if (sched) schedules.push(sched);
        break;
      }
      case 'QualityMetric': {
        const qm = projectQualityMetric(node, meta.pathwayId);
        if (qm) qualityMetrics.push(qm);
        break;
      }
      default:
        // ignore structural / decision / criterion / evidence / etc.
        break;
    }
  }

  return {
    pathwayId: meta.pathwayId,
    pathwayLogicalId: meta.pathwayLogicalId,
    pathwayTitle: meta.pathwayTitle,
    medications,
    labs,
    procedures,
    schedules,
    qualityMetrics,
  };
}

// ─── Per-type projection helpers ─────────────────────────────────────

function strProp(node: NodeResult, key: string): string | undefined {
  const v = node.properties?.[key];
  return typeof v === 'string' ? v : undefined;
}

function projectMedication(
  node: NodeResult,
  pathwayId: string,
): ResolvedMedication | null {
  const name = strProp(node, 'name') ?? node.title;
  const rawRole = strProp(node, 'role');
  if (!rawRole) return null;
  // Trust import-time validation: role was checked against VALID_MEDICATION_ROLES
  // when the pathway was imported, so any string in `role` is a MedicationRole.
  const role = rawRole as MedicationRole;
  return {
    name,
    role,
    dose: strProp(node, 'dose') ?? strProp(node, 'dosage'),
    frequency: strProp(node, 'frequency'),
    duration: strProp(node, 'duration'),
    route: strProp(node, 'route'),
    clinicalRole: strProp(node, 'clinical_role'),
    sourcePathwayId: pathwayId,
    sourceNodeId: node.nodeId,
  };
}

function projectLab(
  node: NodeResult,
  pathwayId: string,
): ResolvedLab | null {
  const name = strProp(node, 'name') ?? node.title;
  return {
    name,
    code: strProp(node, 'code'),
    system: strProp(node, 'system'),
    specimen: strProp(node, 'specimen'),
    sourcePathwayId: pathwayId,
    sourceNodeId: node.nodeId,
  };
}

function projectProcedure(
  node: NodeResult,
  pathwayId: string,
): ResolvedProcedure | null {
  const name = strProp(node, 'name') ?? node.title;
  return {
    name,
    code: strProp(node, 'code') ?? strProp(node, 'procedure_code'),
    system: strProp(node, 'system'),
    sourcePathwayId: pathwayId,
    sourceNodeId: node.nodeId,
  };
}

function projectSchedule(
  node: NodeResult,
  pathwayId: string,
): ResolvedSchedule | null {
  const interval = strProp(node, 'interval');
  const description = strProp(node, 'description');
  if (!interval || !description) return null;
  return {
    interval,
    description,
    sourcePathwayId: pathwayId,
    sourceNodeId: node.nodeId,
  };
}

function projectQualityMetric(
  node: NodeResult,
  pathwayId: string,
): ResolvedQualityMetric | null {
  const name = strProp(node, 'name') ?? node.title;
  const measure = strProp(node, 'measure');
  if (!measure) return null;
  return {
    name,
    measure,
    sourcePathwayId: pathwayId,
    sourceNodeId: node.nodeId,
  };
}
