/**
 * Safety utilities for pathway traversal.
 *
 * NOTE: The TraversalEngine and RetraversalEngine currently implement
 * equivalent safety checks inline (timeout, cycle detection, cascade limit,
 * critical data checks) because they need context-specific handling within
 * the BFS loop. These exported functions remain available for other consumers
 * and are covered by safety.test.ts.
 */
import { GraphNode, SignalBreakdown } from '../confidence/types';
import { RedFlag, MAX_CASCADE_DEPTH } from './types';

export class TraversalTimeoutError extends Error {
  constructor(evaluatedCount: number, totalCount: number) {
    super(`Traversal timeout: ${evaluatedCount} of ${totalCount} nodes evaluated`);
    this.name = 'TraversalTimeoutError';
  }
}

/**
 * Check if evaluating nodeId would create a cycle.
 * The evaluationStack contains nodes currently being evaluated (not just visited).
 */
export function detectCycle(nodeId: string, evaluationStack: Set<string>): boolean {
  return evaluationStack.has(nodeId);
}

/**
 * Throw if the traversal has exceeded the timeout.
 */
export function enforceTimeout(startTimeMs: number, timeoutMs: number): void {
  if (Date.now() - startTimeMs > timeoutMs) {
    throw new TraversalTimeoutError(0, 0);
  }
}

/**
 * Check for missing critical data on a node.
 * Flagged if critical: true AND DATA_PRESENCE/data_completeness signal scored 0.
 */
export function checkMissingCriticalData(
  node: GraphNode,
  breakdown: SignalBreakdown[],
): RedFlag[] {
  const isCritical = node.properties.critical === true;
  if (!isCritical) return [];

  const dataSignal = breakdown.find(
    b => b.signalName === 'data_completeness' || b.signalName === 'DATA_PRESENCE'
  );
  if (!dataSignal || dataSignal.score > 0) return [];

  return [{
    nodeId: node.nodeIdentifier,
    nodeTitle: String(node.properties.title ?? node.nodeIdentifier),
    type: 'missing_critical_data',
    description: `Critical node "${node.properties.title}" is missing required data: ${dataSignal.missingInputs.join(', ')}`,
  }];
}

/**
 * Check if cascade depth has been exceeded during re-traversal.
 */
export function isCascadeLimitReached(currentDepth: number): boolean {
  return currentDepth >= MAX_CASCADE_DEPTH;
}
