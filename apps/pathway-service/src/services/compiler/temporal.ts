// apps/pathway-service/src/services/compiler/temporal.ts
import { sweepableConditions } from '../../resolvers/helpers/resolution-context';
import { collectEncounterAnchorRequirements, PathwayTemporalDefaults } from '../resolution/temporal/cascade';
import { TemporalContextError } from '../resolution/temporal/evaluation-context';
import type { AttributeCodeMap } from '../resolution/types';
import type { CompileError, GraphNodeIn } from './model';

/**
 * V9: parse every temporal override under the v1 policy (the only policy the
 * interpreter will support, Q9) and report whether any condition needs an
 * encounter anchor. Whether a SESSION supplies the anchor is checked at
 * evaluation time (spec §4.9), not here.
 */
export function checkTemporal(
  nodes: GraphNodeIn[],
  codeMap: AttributeCodeMap,
  temporalDefaults: PathwayTemporalDefaults,
  errors: CompileError[],
): boolean {
  const graphNodes = nodes.map((n) => ({ id: n.id, nodeIdentifier: n.id, nodeType: n.type, properties: n.properties }));
  try {
    return collectEncounterAnchorRequirements(sweepableConditions(graphNodes, 'v1', codeMap), 'v1', temporalDefaults).length > 0;
  } catch (e) {
    if (e instanceof TemporalContextError) { errors.push({ code: 'TEMPORAL', message: e.message }); return false; }
    throw e;
  }
}
