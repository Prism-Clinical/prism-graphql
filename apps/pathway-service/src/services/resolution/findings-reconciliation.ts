import { PendingQuestion, RedFlag, RedFlagType } from './types';

/**
 * Reconciling a session's red flags and pending questions after an
 * incremental resolve.
 *
 * Both were APPENDED: `session.redFlags = [...old, ...new]`. A finding whose
 * condition was still true re-emitted an identical copy on every pass and each
 * was kept; a finding whose condition had since resolved was never removed.
 * Care-plan generation blocks on every unacknowledged red flag, so a flag that
 * was true for one instant blocked that session for ever.
 *
 * The reconciliation is a KEYED REPLACE OVER THE PASS'S SCOPE, not a
 * recompute-from-scratch. An incremental resolve re-disposes only a region, so
 * findings about nodes it never looked at are still valid and must survive
 * untouched. That is the shape the answer path already used for pending
 * questions (`.filter(q => q.gateId !== id).concat(...)`), generalised.
 *
 * Ported from `fix/retraversal-red-flag-reconciliation`, which built it around
 * the second traversal engine. The engine is gone; the model is right, so the
 * model is what came across.
 */

/** Every member of `RedFlagType`, as a runtime value. */
export const RED_FLAG_TYPES: readonly RedFlagType[] = [
  'all_branches_excluded',
  'contradiction',
  'missing_critical_data',
  'all_of_branch_unsupported',
  'unroutable_decision',
];

export function isRedFlagType(value: string): value is RedFlagType {
  return (RED_FLAG_TYPES as readonly string[]).includes(value);
}

/**
 * What identifies a red flag across re-derivation: the node it is about, plus
 * its type.
 *
 * Node ID alone is not enough — one node can carry both
 * `all_branches_excluded` and `missing_critical_data`, and collapsing them
 * would let one acknowledgement silence the other. `description` and
 * `branches` are deliberately excluded: both are derived text and values that
 * change wording or confidence between passes for the same underlying
 * finding, so keying on them would make every re-derivation look like a new
 * flag and resurrect an acknowledged one.
 *
 * The separator is a printable sentinel. The original used a literal NUL,
 * which made git treat this file as binary.
 */
export function redFlagKey(flag: { nodeId: string; type: string }): string {
  return `${flag.nodeId}␟${flag.type}`;
}

/**
 * What identifies a pending question: the datum it asks for, or failing that
 * the gate that asks.
 *
 * An escalated datum prompt is deliberately shared — two gates needing the
 * same haemoglobin ask ONCE — so its identity is the datum, not whichever
 * gate happened to raise it first. Keying on `gateId` alone would let the
 * second gate re-derive a duplicate prompt for a value already requested.
 */
export function pendingQuestionKey(q: PendingQuestion): string {
  return q.datumKey ?? q.gateId;
}

/** The (node × type) region of the flag set a single pass may rewrite. */
export interface RedFlagScope {
  /** Nodes the pass re-disposed. */
  nodeIds: Iterable<string>;
  /** Flag types the pass re-derives. */
  types: Iterable<RedFlagType>;
}

/**
 * Carry a provider's acknowledgement across re-derivation.
 *
 * Without this, reconciliation and acknowledgement cancel out: the provider
 * accepts a flag that is genuinely still true, the next pass re-emits it, the
 * replace overwrites the acknowledged copy with a fresh unacknowledged one,
 * and generation is blocked again — the same dead end by another route.
 *
 * When `fix/retraversal-red-flag-reconciliation` lands its acknowledgement
 * metadata (`acknowledgedBy`, `acknowledgedAt`, `acknowledgementReason`),
 * those fields join the carry here.
 */
function carryAcknowledgement(prior: RedFlag, next: RedFlag): RedFlag {
  if (!prior.acknowledged) return next;
  return { ...next, acknowledged: true };
}

/**
 * Replace the flags this pass re-derived, keep every other flag, and dedupe.
 *
 * @param existing  the session's stored flags, in stored order
 * @param derived   the flags this pass derived (must all fall inside `scope`)
 * @param scope     the (node × type) region the pass is authoritative for
 *
 * @throws if a derived flag falls outside `scope`. A derived flag the caller
 * cannot place is an engine/caller disagreement about what was re-evaluated;
 * silently appending it would reintroduce the unbounded growth this replaces.
 * A runtime throw because `src/__tests__` is excluded from `tsconfig` — a type
 * constrains nothing against a test caller.
 */
export function reconcileRedFlags(
  existing: readonly RedFlag[],
  derived: readonly RedFlag[],
  scope: RedFlagScope,
): RedFlag[] {
  const scopeNodes = new Set(scope.nodeIds);
  const scopeTypes = new Set<string>(scope.types);
  const inScope = (f: { nodeId: string; type: string }): boolean =>
    scopeNodes.has(f.nodeId) && scopeTypes.has(f.type);

  const derivedByKey = new Map<string, RedFlag>();
  for (const f of derived) {
    if (!inScope(f)) {
      throw new Error(
        `red flag ${f.type} on node "${f.nodeId}" is outside the declared reconciliation scope`,
      );
    }
    if (!derivedByKey.has(redFlagKey(f))) derivedByKey.set(redFlagKey(f), f);
  }

  const result: RedFlag[] = [];
  const emitted = new Set<string>();

  // Stored order is preserved: a re-derived flag is substituted in place, not
  // moved to the end, so the provider's list does not reshuffle on every edit.
  for (const flag of existing) {
    const key = redFlagKey(flag);
    if (emitted.has(key)) continue; // dedupe what an earlier append duplicated
    if (!inScope(flag)) {
      emitted.add(key);
      result.push(flag);
      continue;
    }
    const next = derivedByKey.get(key);
    if (!next) continue; // in scope and no longer derived => stale, drop it
    emitted.add(key);
    result.push(carryAcknowledgement(flag, next));
  }

  for (const flag of derived) {
    const key = redFlagKey(flag);
    if (emitted.has(key)) continue;
    emitted.add(key);
    result.push(flag);
  }

  return result;
}

/** The gates a single pass may rewrite the pending questions of. */
export interface PendingQuestionScope {
  /** Gates the pass re-disposed. */
  gateIds: Iterable<string>;
  /**
   * Gates to drop regardless of scope — the gate just answered, whose question
   * is settled whether or not the pass looked at it again.
   */
  alsoDropGateIds?: Iterable<string>;
}

/**
 * The same keyed replace for pending questions.
 *
 * The context path appended these too, so a gate that stayed
 * PENDING_QUESTION accumulated one duplicate prompt per context addition.
 *
 * KNOWN LIMIT: an escalated datum prompt raised by a gate inside the region
 * but ALSO needed by a gate outside it is dropped when the inside gate stops
 * needing it, because the outside gate is not re-disposed and cannot re-emit.
 * Bounded — it needs a shared datum straddling the region boundary — and the
 * failure is a missing prompt, which the next full resolve restores.
 */
export function reconcilePendingQuestions(
  existing: readonly PendingQuestion[],
  derived: readonly PendingQuestion[],
  scope: PendingQuestionScope,
): PendingQuestion[] {
  const scopeGates = new Set(scope.gateIds);
  const alsoDrop = new Set(scope.alsoDropGateIds ?? []);

  const derivedByKey = new Map<string, PendingQuestion>();
  for (const q of derived) {
    if (!scopeGates.has(q.gateId)) {
      throw new Error(
        `pending question for gate "${q.gateId}" is outside the declared reconciliation scope`,
      );
    }
    const key = pendingQuestionKey(q);
    if (!derivedByKey.has(key)) derivedByKey.set(key, q);
  }

  const result: PendingQuestion[] = [];
  const emitted = new Set<string>();

  for (const q of existing) {
    const key = pendingQuestionKey(q);
    if (emitted.has(key)) continue;
    if (alsoDrop.has(q.gateId)) continue;
    if (!scopeGates.has(q.gateId)) {
      emitted.add(key);
      result.push(q);
      continue;
    }
    const next = derivedByKey.get(key);
    if (!next) continue; // in scope and no longer asked => settled, drop it
    emitted.add(key);
    result.push(next);
  }

  for (const q of derived) {
    const key = pendingQuestionKey(q);
    if (emitted.has(key)) continue;
    if (alsoDrop.has(q.gateId)) continue;
    emitted.add(key);
    result.push(q);
  }

  return result;
}
