/**
 * Which graph edges mean containment, and the walks built on them.
 *
 * Its own module so the resolvers can share the rule with the engine: tests
 * mock the traversal engine wholesale, and a helper living there vanished with
 * it.
 */

import { GraphContext } from '../confidence/types';

/**
 * Edges that mean "is part of", as opposed to "refers to".
 *
 * REQUIRES runs from a DEPENDENT to its PREREQUISITE ("oral iron REQUIRES the
 * diagnostic step") — typically back UP the tree, into another stage. It says
 * nothing about where the prerequisite lives, so a walk that means "this node
 * and everything under it" must not follow it. Following it is how closing
 * one arm of a fork swept the step CONTAINING the fork, and through it the
 * very branch that had been chosen. The import validator already excludes
 * REQUIRES from its tree-shape checks for the same reason.
 *
 * Used by every walk that CLOSES or CLEARS a region (sweeps, the incremental
 * region, subtree counts). The constructive walk that enqueues children still
 * follows every edge — a prerequisite is normally resolved by the time its
 * dependent is, so that walk finds it written and moves on. Whether it should
 * follow REQUIRES at all is a separate, open question.
 */
export const NON_CONTAINMENT_EDGES = new Set(['REQUIRES']);

export function containmentChildIds(graphContext: GraphContext, id: string): string[] {
  return graphContext
    .outgoingEdges(id)
    .filter(e => !NON_CONTAINMENT_EDGES.has(e.edgeType))
    .map(e => e.targetId);
}

export function containmentParentIds(graphContext: GraphContext, id: string): string[] {
  return graphContext
    .incomingEdges(id)
    .filter(e => !NON_CONTAINMENT_EDGES.has(e.edgeType))
    .map(e => e.sourceId);
}

/**
 * Every node under `roots` (inclusive), by containment.
 *
 * A fork's sweep of its UNCHOSEN branches must stop at these: a node reachable
 * from a branch the fork takes is live, whatever else also reaches it. The
 * sweep runs before the chosen branch is walked, so without this it wrote
 * EXCLUDED over the chosen branch whenever an unchosen one converged on it
 * (workup → gate → the treatment stage containing the chosen step).
 */
export function containmentClosure(graphContext: GraphContext, roots: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const c of containmentChildIds(graphContext, id)) if (!seen.has(c)) queue.push(c);
  }
  return seen;
}
