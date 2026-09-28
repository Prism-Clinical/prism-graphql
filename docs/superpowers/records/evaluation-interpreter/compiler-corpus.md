# Compiler corpus — live stored pathways

- **Date:** 2026-09-27
- **Branch:** `feat/interpreter-01-compiler` @ `e87c2a7` (plus the uncommitted Task 10 script, identical to the commit that adds this file)
- **Mode:** read-only. `node apps/pathway-service/dist/scripts/compile-stored-pathways.js` against `prism_db`; SELECT and Cypher reads only, nothing written.
- **Code map:** the live `pathway_attribute_code_map`; temporal defaults from each pathway's index row.

## Summary

| Pathway | Status | Result |
|---|---|---|
| anemia-in-pregnancy-v1@1.0 | SUPERSEDED | ERR (7 ms, 9 error(s)) |
| anemia-in-pregnancy-v1@1.1 | DRAFT | ERR (1 ms, 9 error(s)) |
| anemia-in-pregnancy-v1@1.2 | DRAFT | ERR (1 ms, 9 error(s)) |
| anemia-in-pregnancy-v1@1.3 | DRAFT | ERR (1 ms, 9 error(s)) |
| anemia-in-pregnancy-v1@1.4 | ACTIVE | OK (2 ms) |
| anemia-in-pregnancy-v1@1.5 | DRAFT | OK (1 ms) |
| anemia-in-pregnancy-v1@1.6 | DRAFT | OK (1 ms) |
| anemia-in-pregnancy-v1@1.7 | DRAFT | OK (2 ms) |
| anemia-pregnancy-v1@1.0 | ARCHIVED | ERR (1 ms, 5 error(s)) |
| chronic-htn-pregnancy-v1@1.0 | DRAFT | ERR (1 ms, 2 error(s)) |
| gestational-hypertension-preeclampsia@1 | DRAFT | ERR (3 ms, 9 error(s)) |
| routine-prenatal-care-v1@1.0 | ARCHIVED | ERR (1 ms, 1 error(s)) |
| vaginal-discharge-pregnancy-v1@1.0 | ARCHIVED | ERR (1 ms, 7 error(s)) |
| vaginitis-in-pregnancy-v1@1.0 | ARCHIVED | ERR (1 ms, 13 error(s)) |

**4/14 pathways compile.**

As expected (plan Task 10 Step 5):
- the live ACTIVE `anemia-in-pregnancy-v1@1.4` compiles;
- anemia 1.1–1.3 fail on the legacy condition dialect (`LT`, `IN`, `EQUALS`, `GTE`) — Q10 archives them;
- GHTN fails with `MISSING_WHEN` on `gate-aspirin-indicated` and `gate-htn-confirmed` and `MULTI_TARGET_NON_ROUTING_GATE` on `gate-htn-diagnosed` (C10, C18), plus the import validator's own messages for the same gates.

Not called out by the plan:
- `chronic-htn-pregnancy-v1@1.0` (DRAFT): `med-hydralazine` and `med-methyldopa` are reached only through `ESCALATES_TO`, which is an `alternative` edge and never reaches (spec §3.3, C8). V2 therefore rejects them as unreachable. This draft needs those medications placed under a Step (or the escalation re-modelled) before it can be activated.
- `vaginitis-in-pregnancy-v1@1.0` (ARCHIVED): bare-string `depends_on` on four gates (V8), and the half-created `gate-new-1` / `guidance-new-1`.
- Archived `anemia-pregnancy-v1`, `routine-prenatal-care-v1`, `vaginal-discharge-pregnancy-v1`: legacy dialect or `when`-less routing gates. Archived; nothing to do unless they are reactivated, which would now be refused.

## Full output

```
ERR   SUPERSEDED anemia-in-pregnancy-v1@1.0 (7 ms, 9 error(s))
        VALIDATION: Gate "gate-anemia-t1t3" condition[0]: operator "IN" is not a valid attribute operator.
        VALIDATION: Gate "gate-anemia-t1t3" condition[1]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-anemia-t2" condition[0]: operator "EQUALS" is not a valid attribute operator.
        VALIDATION: Gate "gate-anemia-t2" condition[1]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-iron-deficient" condition[0]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-oral-iron-response" condition[0]: operator "GTE" is not a valid attribute operator.
        VALIDATION: Gate "gate-severe-anemia" condition[0]: operator "LT" is not a valid attribute operator.
        PAYLOAD gate-anemia-t1t3: Gate "gate-anemia-t1t3": condition on "patient.trimester": IN needs a number value (got "1,3")
        UNMAPPED_ATTRIBUTE gate-oral-iron-response: Gate "gate-oral-iron-response": attribute "lab.hemoglobin_delta_2wk" has no pathway_attribute_code_map row, so it cannot be read
ERR   DRAFT    anemia-in-pregnancy-v1@1.1 (1 ms, 9 error(s))
        VALIDATION: Gate "gate-anemia-t1t3" condition[0]: operator "IN" is not a valid attribute operator.
        VALIDATION: Gate "gate-anemia-t1t3" condition[1]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-anemia-t2" condition[0]: operator "EQUALS" is not a valid attribute operator.
        VALIDATION: Gate "gate-anemia-t2" condition[1]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-iron-deficient" condition[0]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-oral-iron-response" condition[0]: operator "GTE" is not a valid attribute operator.
        VALIDATION: Gate "gate-severe-anemia" condition[0]: operator "LT" is not a valid attribute operator.
        PAYLOAD gate-anemia-t1t3: Gate "gate-anemia-t1t3": condition on "patient.trimester": IN needs a number value (got "1,3")
        UNMAPPED_ATTRIBUTE gate-oral-iron-response: Gate "gate-oral-iron-response": attribute "lab.hemoglobin_delta_2wk" has no pathway_attribute_code_map row, so it cannot be read
ERR   DRAFT    anemia-in-pregnancy-v1@1.2 (1 ms, 9 error(s))
        VALIDATION: Gate "gate-anemia-t1t3" condition[0]: operator "IN" is not a valid attribute operator.
        VALIDATION: Gate "gate-anemia-t1t3" condition[1]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-anemia-t2" condition[0]: operator "EQUALS" is not a valid attribute operator.
        VALIDATION: Gate "gate-anemia-t2" condition[1]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-iron-deficient" condition[0]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-oral-iron-response" condition[0]: operator "GTE" is not a valid attribute operator.
        VALIDATION: Gate "gate-severe-anemia" condition[0]: operator "LT" is not a valid attribute operator.
        PAYLOAD gate-anemia-t1t3: Gate "gate-anemia-t1t3": condition on "patient.trimester": IN needs a number value (got "1,3")
        UNMAPPED_ATTRIBUTE gate-oral-iron-response: Gate "gate-oral-iron-response": attribute "lab.hemoglobin_delta_2wk" has no pathway_attribute_code_map row, so it cannot be read
ERR   DRAFT    anemia-in-pregnancy-v1@1.3 (1 ms, 9 error(s))
        VALIDATION: Gate "gate-anemia-t1t3" condition[0]: operator "IN" is not a valid attribute operator.
        VALIDATION: Gate "gate-anemia-t1t3" condition[1]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-anemia-t2" condition[0]: operator "EQUALS" is not a valid attribute operator.
        VALIDATION: Gate "gate-anemia-t2" condition[1]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-iron-deficient" condition[0]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-oral-iron-response" condition[0]: operator "GTE" is not a valid attribute operator.
        VALIDATION: Gate "gate-severe-anemia" condition[0]: operator "LT" is not a valid attribute operator.
        PAYLOAD gate-anemia-t1t3: Gate "gate-anemia-t1t3": condition on "patient.trimester": IN needs a number value (got "1,3")
        UNMAPPED_ATTRIBUTE gate-oral-iron-response: Gate "gate-oral-iron-response": attribute "lab.hemoglobin_delta_2wk" has no pathway_attribute_code_map row, so it cannot be read
OK    ACTIVE   anemia-in-pregnancy-v1@1.4 (2 ms)
OK    DRAFT    anemia-in-pregnancy-v1@1.5 (1 ms)
OK    DRAFT    anemia-in-pregnancy-v1@1.6 (1 ms)
OK    DRAFT    anemia-in-pregnancy-v1@1.7 (2 ms)
ERR   ARCHIVED anemia-pregnancy-v1@1.0 (1 ms, 5 error(s))
        VALIDATION: Gate "gate-anemia-threshold" condition[0]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-anemia-threshold" condition[1]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-mcv-triage" condition[0]: operator "LT" is not a valid attribute operator.
        VALIDATION: Gate "gate-iron-deficiency-confirmed" condition[0]: operator "LT" is not a valid attribute operator.
        UNMAPPED_ATTRIBUTE gate-mcv-triage: Gate "gate-mcv-triage": attribute "lab.MCV" has no pathway_attribute_code_map row, so it cannot be read
ERR   DRAFT    chronic-htn-pregnancy-v1@1.0 (1 ms, 2 error(s))
        UNREACHABLE med-hydralazine: Node "med-hydralazine" is not reachable from the pathway root through containment or branch edges
        UNREACHABLE med-methyldopa: Node "med-methyldopa" is not reachable from the pathway root through containment or branch edges
ERR   DRAFT    gestational-hypertension-preeclampsia@1 (3 ms, 9 error(s))
        VALIDATION: Gate "gate-aspirin-indicated": has 2 branch targets, so every BRANCHES_TO edge needs a valid `when`. Missing or unreadable on: step-1-2, step-1-3
        VALIDATION: Gate "gate-htn-confirmed": has 2 branch targets, so every BRANCHES_TO edge needs a valid `when`. Missing or unreadable on: step-2-3, step-2-4
        VALIDATION: Gate "gate-htn-diagnosed": only question and llm_text_analysis gates can route to several branches; "compound" is evaluated from the chart and yields no answer to route on
        VALIDATION: Gate "gate-htn-diagnosed": has 3 branch targets, so every BRANCHES_TO edge needs a valid `when`. Missing or unreadable on: stage-3, step-5-2, step-5-3
        MISSING_WHEN gate-aspirin-indicated: Gate "gate-aspirin-indicated": the branch to "step-1-2" needs a `when`, because the gate routes to 2 targets
        MISSING_WHEN gate-aspirin-indicated: Gate "gate-aspirin-indicated": the branch to "step-1-3" needs a `when`, because the gate routes to 2 targets
        MISSING_WHEN gate-htn-confirmed: Gate "gate-htn-confirmed": the branch to "step-2-3" needs a `when`, because the gate routes to 2 targets
        MISSING_WHEN gate-htn-confirmed: Gate "gate-htn-confirmed": the branch to "step-2-4" needs a `when`, because the gate routes to 2 targets
        MULTI_TARGET_NON_ROUTING_GATE gate-htn-diagnosed: Gate "gate-htn-diagnosed": a compound gate is evaluated from the chart and must guard exactly one target, but it has 3 (stage-3, step-5-2, step-5-3). If all of them apply, use one gate per target, or put the target Steps under one Stage and guard that Stage. If they are alternatives, guard one Step that contains a DecisionPoint whose branches go to them.
ERR   ARCHIVED routine-prenatal-care-v1@1.0 (1 ms, 1 error(s))
        VALIDATION: Gate "gate-rh-negative" condition[0]: operator "EQUALS" is not a valid attribute operator.
ERR   ARCHIVED vaginal-discharge-pregnancy-v1@1.0 (1 ms, 7 error(s))
        VALIDATION: Gate "gate-etiology": has 5 branch targets, so every BRANCHES_TO edge needs a valid `when`. Missing or unreadable on: step-3-1, step-3-2, step-3-3, step-3-4, step-3-5
        VALIDATION: Gate "gate-metronidazole-allergy" condition[0]: operator "EQUALS" is not a valid attribute operator.
        MISSING_WHEN gate-etiology: Gate "gate-etiology": the branch to "step-3-1" needs a `when`, because the gate routes to 5 targets
        MISSING_WHEN gate-etiology: Gate "gate-etiology": the branch to "step-3-2" needs a `when`, because the gate routes to 5 targets
        MISSING_WHEN gate-etiology: Gate "gate-etiology": the branch to "step-3-3" needs a `when`, because the gate routes to 5 targets
        MISSING_WHEN gate-etiology: Gate "gate-etiology": the branch to "step-3-4" needs a `when`, because the gate routes to 5 targets
        MISSING_WHEN gate-etiology: Gate "gate-etiology": the branch to "step-3-5" needs a `when`, because the gate routes to 5 targets
ERR   ARCHIVED vaginitis-in-pregnancy-v1@1.0 (1 ms, 13 error(s))
        VALIDATION: node[51] (gate-new-1): Gate missing required property "title"
        VALIDATION: node[51] (gate-new-1): Gate missing required property "default_behavior"
        VALIDATION: node[52] (guidance-new-1): Guidance missing required property "topic"
        VALIDATION: node[52] (guidance-new-1): Guidance missing required property "instructions"
        VALIDATION: Gate "gate-new-1": must have at least one outbound edge
        DEPENDS_ON gate-dx-bv: Gate "gate-dx-bv": depends_on must be a non-empty array of { node_id, status } (got "step-1-3")
        DEPENDS_ON gate-dx-trich: Gate "gate-dx-trich": depends_on must be a non-empty array of { node_id, status } (got "step-1-3")
        DEPENDS_ON gate-dx-vvc: Gate "gate-dx-vvc": depends_on must be a non-empty array of { node_id, status } (got "step-1-3")
        DEFAULT_BEHAVIOR gate-new-1: Gate "gate-new-1": default_behavior must be "skip" or "traverse" (got "undefined")
        NO_TARGET gate-new-1: Gate "gate-new-1": has no BRANCHES_TO target
        DEPENDS_ON gate-trich-positive-toc: Gate "gate-trich-positive-toc": depends_on must be a non-empty array of { node_id, status } (got "step-2-2")
        UNREACHABLE gate-new-1: Node "gate-new-1" is not reachable from the pathway root through containment or branch edges
        UNREACHABLE guidance-new-1: Node "guidance-new-1" is not reachable from the pathway root through containment or branch edges
4/14 pathways compile
```
