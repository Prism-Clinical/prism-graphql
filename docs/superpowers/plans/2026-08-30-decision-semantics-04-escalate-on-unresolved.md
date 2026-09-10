# Decision Semantics 04 — Escalate on Unresolved Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a gate cannot answer because the data it needs is missing or untrustworthy, ask the provider for that datum instead of silently taking `default_behavior`.

**Architecture:** A gate that cannot answer already reports why — plan 02 added `dataUnavailable` ("no usable value") and surfaced `indeterminate` ("values exist but cannot be ordered"). This plan gives the author a switch, `on_unresolved`, that turns either signal into a pending question, and routes the answer back in **as a fact rather than a verdict**: answering "Hb = 9" adds a lab result the kernel then evaluates normally. That reuses `addPatientContext`'s existing merge-and-reassemble path rather than inventing a second way for data to enter a session, and it is what makes one answer resolve every gate reading that datum.

**Tech Stack:** TypeScript 5, Apollo Server 4 + Federation 2, Jest + ts-jest; `prism-admin-dashboard` (Next.js 16) for the authoring and answering surfaces.

**Spec:** `docs/superpowers/specs/2026-08-30-decision-semantics-design.md` (W2, and the W1 correction it depends on)

**Depends on:**
- **Plan 01** — under `legacy-v0` neither signal is computed and this plan is inert.
- **Plan 02** — `indeterminate` and `dataUnavailable` are what escalation keys on.
- **Plan 03** — this workstream is "answer → gate flips → subtree re-resolves". Before plan 03 the flip stopped at the gate row, so escalation would have shipped and visibly done nothing.

## The premise, corrected

The spec's original W2 keyed escalation on `indeterminate` alone. Executing plan 02 showed that would never fire for a missing measurement, which is the case the whole workstream exists for. **Escalation keys on `indeterminate` OR `dataUnavailable`.**

Which conditions can produce either signal is not uniform, and it bounds what this plan can ask about:

| Operator class | `indeterminate`? | `dataUnavailable`? | Escalatable? |
|---|---|---|---|
| membership (`includes_code`, `exists`) | **never** — `selectFacts` fails OPEN for this class | no | **No.** No code on a problem list is real evidence of absence. The gate answered. |
| scalar (`less_than`, `greater_than`) | yes | yes | **Yes** — ask for the value |
| attribute (`patient.trimester`) | yes | no | **Yes** — ask for the value |
| aggregate (`count_in_window`, `trend_*`) | yes | no | **No, this plan.** See below. |

**Aggregates are deliberately out of scope.** A `count_in_window` or `trend_up` gate that cannot decide needs a *series*, not a value. There is no honest single answer to inject as a fact — "the count is 3" is a derived quantity, not an observation, and storing it would put a fabricated fact in the patient's record. Such gates keep today's `default_behavior`. Revisit only with a design for asking about series.

## Decisions taken

1. **Answers become facts, not verdicts** (spec W2). An answered data question is injected through the same merge-and-reassemble path `addPatientContext` uses. Consequences that are requirements, not optimisations:
   - the provider is asked **once** per datum, and every gate reading it resolves — five gates on the anemia pathway read `718-7`;
   - the answer participates in horizon and status selection like any other fact, instead of bypassing the kernel;
   - it is the substrate a future source-chain would need.
2. **An escalated answer must NOT land in `session.gateAnswers`.** That map is what `evaluateQuestion` reads, and an entry there would make a data gate look like an answered *question* gate. The answer is a fact; the gate re-evaluates from facts.
3. **Provider-asserted facts are distinguishable in the audit trail.** A clinician's assertion is not an observation, and the evidence trail must not imply the chart contained it.
4. **`on_unresolved` defaults to `'ask'`** (user decision, 2026-08-30). Sparse-chart resolutions become materially more interactive. That is the intent.
5. **The mutation keeps the name `answerGateQuestion` in this plan.** The spec has W3 generalising it to `answerPendingDecision`; doing it here as well would mean two renames of the same call sites.

## Global Constraints

- **A definite `false` never escalates.** A scalar gate that read a real value above threshold has answered; a membership gate that found no code has answered. Only `indeterminate` or `dataUnavailable` escalate.
- **Never fabricate clinical content.** Generated prompt text names the datum required and nothing else — no guidance, no hint at the expected answer, no interpretation.
- **The suite is not green.** 9 pre-existing failures in `data-completeness-scorer.test.ts` and `patient-match-scorer.test.ts`. Do not fix them.
- **`npm run typecheck` is not a gate** (~4000 pre-existing monorepo errors), and ts-jest runs with diagnostics disabled so jest-green does not mean it compiles. Use `npx tsc --noEmit -p apps/pathway-service/tsconfig.json`, which is clean and must stay clean.
- **Never chain `cd` with other commands.** Use `git -C <path>` / `npm --prefix <path>`.
- Conventional commit prefixes. No `@anthropic.com` / `@claude.com` in commits.

---

### Task 1: The `on_unresolved` property

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/types.ts` (`GateProperties`)
- Modify: `apps/pathway-service/src/services/import/validator.ts` (`validateGateNodes`)
- Modify: `apps/pathway-service/src/services/import/types.ts` (a `VALID_ON_UNRESOLVED` vocabulary beside `VALID_BRANCH_MODES`)
- Test: `apps/pathway-service/src/__tests__/validator.test.ts` (extend)

**Interfaces:**
- Produces: `GateProperties.on_unresolved?: 'ask' | 'default'`, and `VALID_ON_UNRESOLVED = ['ask', 'default'] as const`. Task 3 reads the property; nothing else does.

- [ ] **Step 1: Write the failing tests**

Append to the Gate-validation describe in `validator.test.ts`, mirroring the `branch_mode` cases already there:

```typescript
    it('should accept a Gate with on_unresolved "ask"', () => {
      const pw = clonePathway();
      pw.nodes.push({
        id: 'gate-ask',
        type: 'Gate' as any,
        properties: {
          title: 'Anaemic?',
          gate_type: 'patient_attribute',
          default_behavior: 'skip',
          on_unresolved: 'ask',
          condition: { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 },
        },
      });
      pw.edges.push({ from: 'step-1-1', to: 'gate-ask', type: 'HAS_GATE' as any });
      pw.edges.push({ from: 'gate-ask', to: 'step-1-2', type: 'BRANCHES_TO' as any });
      expect(validatePathwayJson(pw).valid).toBe(true);
    });

    it('should reject an invalid on_unresolved value', () => {
      const pw = clonePathway();
      pw.nodes.push({
        id: 'gate-bad',
        type: 'Gate' as any,
        properties: {
          title: 'Anaemic?',
          gate_type: 'patient_attribute',
          default_behavior: 'skip',
          on_unresolved: 'escalate',
          condition: { field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 },
        },
      });
      pw.edges.push({ from: 'step-1-1', to: 'gate-bad', type: 'HAS_GATE' as any });
      pw.edges.push({ from: 'gate-bad', to: 'step-1-2', type: 'BRANCHES_TO' as any });
      const result = validatePathwayJson(pw);
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('on_unresolved'));
    });
```

- [ ] **Step 2: Run to verify the second fails**

Run: `npx jest apps/pathway-service/src/__tests__/validator.test.ts -t on_unresolved`

Expected: the "accept" case passes (unknown properties are permitted today), the "reject" case FAILS.

- [ ] **Step 3: Implement**

In `import/types.ts`, beside `VALID_BRANCH_MODES`:

```typescript
export const VALID_ON_UNRESOLVED = ['ask', 'default'] as const;
export type OnUnresolved = typeof VALID_ON_UNRESOLVED[number];
```

In `validator.ts`'s Gate block, mirroring the `branch_mode` check:

```typescript
    const onUnresolved = props.on_unresolved as string | undefined;
    if (onUnresolved && !VALID_ON_UNRESOLVED.includes(onUnresolved as OnUnresolved)) {
      errors.push(
        `Gate "${gate.id}": invalid on_unresolved "${onUnresolved}". Must be one of: ${VALID_ON_UNRESOLVED.join(', ')}`,
      );
    }
```

In `resolution/types.ts`, on `GateProperties`:

```typescript
  /**
   * What to do when the gate cannot answer — `indeterminate` (values exist
   * but cannot be ordered) or `dataUnavailable` (a scalar comparison had no
   * usable value). Absent means `'ask'`.
   *
   * `'ask'`     — surface a pending question for the datum and hold the
   *               subtree, exactly as an unanswered question gate does.
   * `'default'` — apply `default_behavior`, which is what every gate did
   *               before this existed.
   *
   * A gate that ANSWERED — including one that answered "no" — never consults
   * this. Only genuine inability to decide does.
   */
  on_unresolved?: 'ask' | 'default';
```

- [ ] **Step 4: Verify and commit**

```bash
npx jest apps/pathway-service/src/__tests__/validator.test.ts
npx tsc --noEmit -p apps/pathway-service/tsconfig.json
git add apps/pathway-service/src
git commit -m "feat(pathway-service): add the Gate on_unresolved property

Authoring switch for what a gate does when it cannot answer. Validated
at import; nothing reads it yet."
```

---

### Task 2: Describe the datum a condition needs

**Files:**
- Create: `apps/pathway-service/src/services/resolution/unresolved-prompt.ts`
- Test: `apps/pathway-service/src/__tests__/unresolved-prompt.test.ts` (create)

**Interfaces:**
- Produces:

```typescript
/** What to ask for, when a condition could not be evaluated. */
export interface UnresolvedAsk {
  /** Stable identity of the datum — the dedup key. */
  datumKey: string;
  prompt: string;
  answerType: AnswerType;
  /** Where an answer gets injected. */
  target:
    | { kind: 'lab'; code: string; system: string }
    | { kind: 'vital'; path: string }
    | { kind: 'attribute'; path: string };
}

/** `null` when the condition is not one this plan can ask about. */
export function askFor(condition: GateCondition): UnresolvedAsk | null;
```

**Scope, restated because it is the crux:** `askFor` returns `null` for membership and aggregate conditions. Membership never reaches either signal, and an aggregate needs a series no single answer can supply.

- [ ] **Step 1: Write the failing tests**

Create `apps/pathway-service/src/__tests__/unresolved-prompt.test.ts`:

```typescript
import { askFor } from '../services/resolution/unresolved-prompt';
import { AnswerType } from '../services/resolution/types';

describe('askFor', () => {
  it('asks for a lab value by code and system', () => {
    const ask = askFor({
      field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11,
    } as never)!;
    expect(ask.datumKey).toBe('LOINC:718-7');
    expect(ask.answerType).toBe(AnswerType.NUMERIC);
    expect(ask.target).toEqual({ kind: 'lab', code: '718-7', system: 'LOINC' });
    // Names the datum. Says nothing about what answer the pathway expects.
    expect(ask.prompt).toContain('718-7');
    expect(ask.prompt).not.toMatch(/anaemi|anemi|low|below|abnormal/i);
  });

  it('asks for a vital by its dotted path', () => {
    const ask = askFor({
      field: 'vitals', operator: 'greater_than', value: 'systolic_bp', threshold: 130,
    } as never)!;
    expect(ask.datumKey).toBe('vitals.systolic_bp');
    expect(ask.answerType).toBe(AnswerType.NUMERIC);
    expect(ask.target).toEqual({ kind: 'vital', path: 'systolic_bp' });
  });

  it('asks for an attribute by its dotted path', () => {
    const ask = askFor({
      attribute: 'patient.trimester', operator: 'equals', value: 2,
    } as never)!;
    expect(ask.datumKey).toBe('patient.trimester');
    expect(ask.target).toEqual({ kind: 'attribute', path: 'patient.trimester' });
  });

  // The two classes this plan cannot honestly ask about.
  it('refuses a membership condition — no code found is a real answer', () => {
    expect(askFor({
      field: 'conditions', operator: 'includes_code', value: 'E11.9', system: 'ICD-10',
    } as never)).toBeNull();
  });

  it('refuses an aggregate condition — the answer is a series, not a value', () => {
    expect(askFor({
      field: 'labs', operator: 'count_in_window', value: '718-7', system: 'LOINC', window_days: 180,
    } as never)).toBeNull();
  });

  it('gives two gates on the same datum the same key', () => {
    const a = askFor({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 11 } as never)!;
    const b = askFor({ field: 'labs', operator: 'less_than', value: '718-7', system: 'LOINC', threshold: 7 } as never)!;
    expect(a.datumKey).toBe(b.datumKey);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest apps/pathway-service/src/__tests__/unresolved-prompt.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Classify with `operatorClass` from `temporal/contract.ts` — the same function the kernel uses, so this cannot drift from what actually produces the signals. Return `null` for `membership` and `aggregate`.

Prompt wording: `"<display or code> (<system> <code>) — most recent value?"` for labs, `"<path> — current value?"` for vitals and attributes. Nothing else. The test asserts the absence of interpretive words; keep it that way.

- [ ] **Step 4: Verify and commit**

```bash
npx jest apps/pathway-service/src/__tests__/unresolved-prompt.test.ts
npx tsc --noEmit -p apps/pathway-service/tsconfig.json
git add apps/pathway-service/src
git commit -m "feat(pathway-service): derive what to ask for from a condition

askFor turns a condition the kernel could not evaluate into the datum to
request, with a dedup key so two gates reading one lab ask once.

Returns null for membership (no code on a problem list is a real answer,
not a gap) and aggregate (a count or trend needs a series; there is no
honest single value to inject as a fact)."
```

---

### Task 3: Escalate in the traversal

**Files:**
- Modify: `apps/pathway-service/src/services/resolution/traversal-engine.ts` (`disposeNode`, the Gate branch's unsatisfied path)
- Test: `apps/pathway-service/src/__tests__/escalate-on-unresolved.test.ts` (create)

**Interfaces:**
- Consumes: `askFor` (Task 2); `GateProperties.on_unresolved` (Task 1); `GateEvaluationResult.indeterminate` / `.dataUnavailable` (plan 02).
- Produces: `PendingQuestion` entries carrying the new `datumKey` and `target`, so Task 4 knows where to inject the answer. Extend `PendingQuestion` with `datumKey?: string` and `askTarget?: UnresolvedAsk['target']`.

**Where it goes.** In `disposeNode`'s Gate branch there is already a three-way choice on the unsatisfied path: unanswered question → pend; `default_behavior === SKIP` → gate out; otherwise → traverse anyway. Escalation is a fourth arm, tested **before** the `default_behavior` arms and after the unanswered-question arm:

```
unsatisfied
  ├── unanswered question gate            → pend (existing)
  ├── (indeterminate || dataUnavailable)
  │     && on_unresolved !== 'default'
  │     && askFor(condition) !== null      → pend for the DATUM  ← new
  ├── default_behavior === SKIP            → gate out (existing)
  └── otherwise                            → traverse (existing)
```

Reuse the existing pend arm's body — mark the gate `PENDING_QUESTION`, `markSubtree` the descendants, push a `PendingQuestion` with `affectedSubtreeSize` / `estimatedImpact`. The only differences are where the prompt comes from and the two new fields.

**An authored `prompt` wins over the generated one** (spec W2). `askFor` knows the
condition, not the gate, so the override is applied here rather than inside it:
`gateProps.prompt ?? ask.prompt`. The generated text is a fallback so that every
escalatable gate can ask without extra authoring — not a preference for machine
wording over a clinician's.

**Dedup lives here.** Before pushing, skip when `pendingQuestions` already carries the same `datumKey`. The gate still pends — its subtree is still held — but only one question is asked. One injected fact resolves every gate reading that datum, so a second question would be asking for something already requested.

- [ ] **Step 1: Write the failing tests**

Create `apps/pathway-service/src/__tests__/escalate-on-unresolved.test.ts`. Build on `incremental-traversal.test.ts`'s harness (same `node`/`edge`/`engine` helpers), pinned to `v1` with an assembled fact store — under `legacy-v0` neither signal exists and every case would pass vacuously.

Cases:

1. A scalar gate with no value and `on_unresolved` absent → `PENDING_QUESTION`, one pending question naming the datum, subtree `PENDING_QUESTION` not `GATED_OUT`.
2. The same gate with `on_unresolved: 'default'` → `GATED_OUT`, no pending question. Today's behaviour, still reachable.
3. A gate that read a real value and answered "no" → `GATED_OUT`, **no** pending question. The central negative.
4. A membership gate with no matching code → `GATED_OUT`, no pending question.
5. An aggregate gate that cannot decide → `GATED_OUT` (or its `default_behavior`), no pending question.
6. Two gates reading `718-7`, both unresolvable → **one** pending question; both gates `PENDING_QUESTION`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest apps/pathway-service/src/__tests__/escalate-on-unresolved.test.ts`

Expected: cases 1 and 6 FAIL (gates gate out, no questions). Cases 2–5 pass already — they assert today's behaviour and must keep passing.

- [ ] **Step 3: Implement**

In `disposeNode`, immediately after the `isUnansweredQuestion` arm:

```typescript
          // A gate that could not DECIDE, as opposed to one that decided "no".
          // `askFor` returns null for the classes there is no honest question
          // for, so this arm cannot fire on a membership or aggregate gate.
          const unresolved =
            gateResult.indeterminate === true || gateResult.dataUnavailable === true;
          const ask =
            unresolved && gateProps.on_unresolved !== 'default' && gateProps.condition
              ? askFor(gateProps.condition)
              : null;

          if (ask) {
            resolutionState.set(nodeIdentifier, {
              nodeId: nodeIdentifier,
              nodeType: node.nodeType,
              title: nodeTitle(node),
              status: NodeStatus.PENDING_QUESTION,
              confidence: 0,
              confidenceBreakdown: [],
              excludeReason: gateResult.reason,
              parentNodeId,
              depth,
              properties: node.properties,
              ...uncertaintyFields,
            });

            const childIds = graphContext.outgoingEdges(nodeIdentifier).map(e => e.targetId);
            const subtreeSize = countSubtree(childIds, graphContext);
            markSubtree(childIds, graphContext, resolutionState, NodeStatus.PENDING_QUESTION,
              `Awaiting ${ask.datumKey}`, nodeIdentifier, depth);

            // Dedup on the DATUM. The gate still pends — its subtree is still
            // held — but one injected fact resolves every gate reading it, so a
            // second question would ask for something already requested.
            if (!pendingQuestions.some(q => q.datumKey === ask.datumKey)) {
              pendingQuestions.push({
                gateId: nodeIdentifier,
                // An authored prompt beats the generated one.
                prompt: gateProps.prompt ?? ask.prompt,
                answerType: ask.answerType,
                affectedSubtreeSize: subtreeSize,
                estimatedImpact: subtreeSize > 3 ? 'high' : subtreeSize > 1 ? 'medium' : 'low',
                datumKey: ask.datumKey,
                askTarget: ask.target,
              });
            }
            return;
          }
```

For a `compound` gate, `gateProps.condition` is absent and `gateProps.conditions`
carries the list. Ask for the FIRST entry whose `askFor` is non-null — a compound
gate that could not decide needs at least that datum, and asking for one at a time
is honest about what the next answer unlocks.

- [ ] **Step 4: Verify**

```bash
npx jest apps/pathway-service
npx tsc --noEmit -p apps/pathway-service/tsconfig.json
```

Expected: failures confined to the two known scorer suites.

**Watch `anemia-pathway-e2e.test.ts` in particular.** It is pinned to `legacy-v0`, so it should be untouched — if it moves, escalation is firing on a policy that cannot produce either signal, which means the guard is wrong.

- [ ] **Step 5: Commit**

```bash
git add apps/pathway-service/src
git commit -m "feat(pathway-service): escalate an unresolvable gate to a question

A gate that cannot answer now asks for the datum it needed instead of
silently taking default_behavior. Keys on indeterminate OR
dataUnavailable — indeterminate alone would never fire for a missing
measurement, which is the case this exists for.

A gate that ANSWERED never escalates, including one that answered no.
Two gates needing one datum ask once."
```

---

### Task 4: An answer becomes a fact

**Files:**
- Modify: `apps/pathway-service/src/resolvers/mutations/resolution.ts` (`answerGateQuestion`)
- Test: `apps/pathway-service/src/__tests__/escalated-answer-injection.test.ts` (create)

**Interfaces:**
- Consumes: `PendingQuestion.datumKey` / `.askTarget` (Task 3).
- Produces: no new export. `answerGateQuestion` gains a branch.

**The flow.** When the answered gate's pending question carries an `askTarget`, the answer is a datum, not a verdict:

1. Build an `AdditionalContextInput` fragment from `askTarget` + the answer's `numericValue` — a `labResults` entry for `lab`, a `vitalSigns` path for `vital`, a `patientAttributes` key for `attribute`.
2. Merge it into `session.additionalContext` exactly as `addPatientContext` does, and re-assemble the fact store from the merged bag under the session's stored clock. **Reuse that code path; do not write a second one.**
3. Seed `resolveIncrementally` from every gate whose pending question shared the `datumKey` — not just the one answered.
4. **Do not write to `session.gateAnswers`.** That map is what `evaluateQuestion` reads; an entry there would make a data gate look like an answered question gate, and it would be consulted instead of the fact on every future retraversal.

- [ ] **Step 1: Write the failing tests**

1. Answering an escalated lab question adds the value to `session.additionalContext.labResults` and the gate becomes `INCLUDED` or `GATED_OUT` **on the value**, not on the answer's presence.
2. `session.gateAnswers` is unchanged — decision 2, and the one most likely to be got wrong by analogy with question gates.
3. Two gates shared a `datumKey`; answering once resolves **both**.
4. The injected fact is marked as provider-asserted, distinguishable from chart data in the evidence trail (decision 3).
5. Answering a genuine question gate still records a `GateAnswer` as before — the existing path is untouched.

- [ ] **Step 2: Run to verify they fail**

- [ ] **Step 3: Implement**

In `answerGateQuestion`, before the existing gate-answer path:

```typescript
    // Is this pending question a request for a DATUM rather than a clinical
    // question? The pending entry carries where the answer belongs.
    const pending = session.pendingQuestions.find(q => q.gateId === args.gateId);
    if (pending?.askTarget) {
      const value = args.answer.numericValue;
      if (value === undefined || value === null) {
        throw new GraphQLError(
          `Gate "${args.gateId}" is a request for ${pending.datumKey}; supply numericValue`,
          { extensions: { code: 'BAD_USER_INPUT' } },
        );
      }

      // Build the same shape addPatientContext accepts, so one merge-and-
      // reassemble path serves both doors.
      const fragment: Partial<AdditionalContextInput> =
        pending.askTarget.kind === 'lab'
          ? { labResults: [{
              code: pending.askTarget.code,
              system: pending.askTarget.system,
              value,
              // Provider assertion, not an observation off the chart. The
              // evidence trail must be able to say which it was.
              sourceId: PROVIDER_ASSERTED_SOURCE,
            }] }
          : pending.askTarget.kind === 'vital'
            ? { vitalSigns: { [pending.askTarget.path]: value } }
            : { patientAttributes: { [pending.askTarget.path.split('.').slice(1).join('.')]: value } };

      // Merge + re-assemble exactly as addPatientContext does. Extract that
      // block into a shared helper rather than copying it — two ways for a
      // fact to enter a session is how the engines diverged in the first place.
      const merged = mergeAdditionalContext(session.additionalContext, fragment);

      // Every gate that asked for THIS datum re-resolves, not just the one
      // answered — that is what makes one answer serve five gates.
      const seeds = new Set(
        session.pendingQuestions
          .filter(q => q.datumKey === pending.datumKey)
          .map(q => q.gateId),
      );
      // ...then resolveIncrementally(seeds, ...) with the re-assembled store,
      // drop the answered questions from session.pendingQuestions, and persist.
      // Deliberately NO write to session.gateAnswers — see decision 2.
    }
```

`PROVIDER_ASSERTED_SOURCE` is a new exported constant; `mergeAdditionalContext` is
the merge block lifted out of `addPatientContext`. Extract it rather than
duplicating: this plan's whole premise is that there is one way for a fact to
reach a session.

- [ ] **Step 4: Verify and commit**

```bash
npx jest apps/pathway-service
npx tsc --noEmit -p apps/pathway-service/tsconfig.json
git add apps/pathway-service/src
git commit -m "feat(pathway-service): inject an escalated answer as a fact

An answered data question adds the value to the session's additional
context and re-assembles, rather than short-circuiting the gate to
satisfied. The gate then decides on the VALUE, which is what makes one
answer resolve every gate reading that datum — five on the anemia
pathway read 718-7.

The answer deliberately does NOT enter session.gateAnswers: that map is
what evaluateQuestion reads, and an entry there would make a data gate
look like an answered question gate and be consulted instead of the fact
on every later retraversal.

Provider-asserted facts are marked as such — a clinician's assertion is
not an observation and the evidence trail must not imply the chart
contained it."
```

---

### Task 5: Surface it in the admin dashboard

**Files:**
- Modify: `prism-admin-dashboard/src/components/encounter-simulator/PendingGatesPanel.tsx`
- Modify: `prism-admin-dashboard/src/lib/graphql/queries/resolution.ts` (select the new fields)
- Modify: `prism-admin-dashboard/src/components/editor/` — the Gate property editor, to author `on_unresolved`
- Modify: `prism-admin-dashboard/src/lib/pathway-json/validator.ts` (client-side `on_unresolved` check, mirroring the server)

**Interfaces:**
- Consumes: `PendingQuestion.datumKey` / `askTarget`, and `Gate.on_unresolved`.

**Why it is not optional.** A pending question nobody can see is the same silence this workstream exists to remove. The panel must distinguish a **datum request** ("what is this patient's haemoglobin?") from a **clinical question** ("is the patient symptomatic?") — they read differently to a clinician and the first is answerable from a chart.

- [ ] **Step 1: Select the new fields** in the resolution query and confirm they arrive.
- [ ] **Step 2: Render datum requests distinctly** in `PendingGatesPanel`, with a numeric input and the unit where the condition carries one.
- [ ] **Step 3: Author `on_unresolved`** in the Gate editor — a two-way control defaulting to `ask`, with the default stated in the UI rather than implied by an empty field.
- [ ] **Step 4: Mirror the validation** client-side.
- [ ] **Step 5: Verify** — `npx tsc --noEmit -p tsconfig.json` in the dashboard (its `npm run lint` is broken repo-wide: ESLint 9, no `eslint.config.js`).
- [ ] **Step 6: Commit**

---

## Verification

- [ ] `npx jest apps/pathway-service` — failures confined to the two known scorer suites.
- [ ] `npx tsc --noEmit -p apps/pathway-service/tsconfig.json` — clean.
- [ ] `npm run build --prefix apps/pathway-service` — succeeds.
- [ ] `npx tsc --noEmit -p tsconfig.json` in `prism-admin-dashboard` — clean.
- [ ] Live: `startMultiPathwayResolution` on `anemia-in-pregnancy-v1` v1.4 with an **empty** patient returns pending questions for `718-7` and `2276-4` — one each, not five — and answering `718-7` resolves every gate reading it.

## Expect this to look like a regression

The anemia pathway goes from near-silent to asking several questions on a sparse chart. That is the intent — it is the "nothing asks" complaint answered directly — and the temptation when it lands will be to soften the default back to `'default'`. Don't. The pathway was always unable to decide those gates; it just never said so.

## What this plan deliberately does not do

- Aggregate conditions. `count_in_window` and `trend_*` need a series, not a value.
- Renaming `answerGateQuestion` to `answerPendingDecision` — W3's plan owns that, so the call sites move once.
- `branch_mode` / `SELECTS_BRANCH` enforcement, and question per-branch routing.
