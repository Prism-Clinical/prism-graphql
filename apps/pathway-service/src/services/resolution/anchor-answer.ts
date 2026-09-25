import type { GraphContext } from '../confidence/types';
import type { DependencyMap, GateAnswer, PendingQuestion } from './types';
import {
  anchorDateProblem,
  anchorKeyFor,
  parseWindowFrom,
} from './temporal/anchored-window';

/**
 * How an answer to `answerPendingDecision` sets a `window_from` start date.
 *
 * Two ways in, one effect:
 *
 *  - **Asked.** The gate pended with a DATE question (`askTarget.kind ===
 *    'anchor'`) because no source resolved the anchor.
 *  - **Edited.** The anchor DID resolve — from the care plan or an order — but
 *    the clinician knows better (prescribed is not started). They answer the
 *    gate with a `dateValue` although nothing is pending. Without this the
 *    resolved date would be visible but not correctable, which is the half of
 *    the decision ("clinician-editable") that matters most.
 *
 * Either way the date is stored under the ANCHOR key, not the gate id, so it
 * re-anchors every gate reading that class, and it is the first source
 * `resolveWindowAnchor` consults. It is never written under the gate's own id:
 * that map entry is what a question gate's verdict and a DecisionPoint's
 * branch choice are read from.
 */
export type AnchorAnswerPlan =
  | { kind: 'none' }
  | { kind: 'problem'; message: string }
  | {
      kind: 'anchor';
      key: string;
      dateValue: string;
      /** Every gate to re-dispose: the asker(s), the answered gate, and every gate reading the key. */
      rootGateIds: string[];
    };

function windowFromKeysOf(properties: Record<string, unknown> | undefined): string[] {
  if (!properties) return [];
  const conditions: unknown[] = [
    ...(properties.condition ? [properties.condition] : []),
    ...(Array.isArray(properties.conditions) ? properties.conditions : []),
  ];
  const keys = new Set<string>();
  for (const c of conditions) {
    const raw = (c as { window_from?: unknown } | null)?.window_from;
    if (raw === undefined) continue;
    // Imported, preflighted and evaluated already, so it parses; a throw here
    // would be a corrupt graph, and it should surface as one.
    keys.add(anchorKeyFor(parseWindowFrom(raw, 'window_from')));
  }
  return [...keys];
}

export function planAnchorAnswer(input: {
  nodeId: string;
  answer: Pick<GateAnswer, 'booleanValue' | 'numericValue' | 'selectedOption' | 'dateValue'>;
  pendingQuestions: readonly PendingQuestion[];
  dependencyMap: DependencyMap;
  graphContext: GraphContext;
  evaluationAsOf: string;
}): AnchorAnswerPlan {
  const { nodeId, answer } = input;

  const pending = input.pendingQuestions.find(
    (q) =>
      q.askTarget?.kind === 'anchor' &&
      (q.gateId === nodeId || (q.askedByNodeIds ?? []).includes(nodeId)),
  );

  let key: string;
  if (pending && pending.askTarget?.kind === 'anchor') {
    key = pending.askTarget.key;
  } else if (answer.dateValue !== undefined && answer.dateValue !== null) {
    const keys = windowFromKeysOf(
      input.graphContext.getNode(nodeId)?.properties as Record<string, unknown> | undefined,
    );
    if (keys.length === 0) {
      return {
        kind: 'problem',
        message:
          `"${nodeId}" has no window_from condition — dateValue sets a treatment start date ` +
          `and answers nothing else`,
      };
    }
    if (keys.length > 1) {
      return {
        kind: 'problem',
        message:
          `"${nodeId}" anchors on ${keys.length} different treatments (${keys.join(', ')}); ` +
          `answer the pending start-date question for the one you mean`,
      };
    }
    key = keys[0];
  } else {
    return { kind: 'none' };
  }

  const others = (['booleanValue', 'numericValue', 'selectedOption'] as const).filter(
    (k) => answer[k] !== undefined && answer[k] !== null,
  );
  if (others.length > 0) {
    return {
      kind: 'problem',
      message: `a treatment start date is answered with dateValue alone; got ${others.join(' and ')}`,
    };
  }
  const problem = anchorDateProblem(answer.dateValue, input.evaluationAsOf);
  if (problem !== null) return { kind: 'problem', message: problem };

  const roots = new Set<string>([nodeId]);
  if (pending) {
    roots.add(pending.gateId);
    for (const id of pending.askedByNodeIds ?? []) roots.add(id);
  }
  for (const [gateId, fields] of input.dependencyMap.gateContextFields) {
    if (fields.has(key)) roots.add(gateId);
  }

  return { kind: 'anchor', key, dateValue: answer.dateValue as string, rootGateIds: [...roots] };
}
