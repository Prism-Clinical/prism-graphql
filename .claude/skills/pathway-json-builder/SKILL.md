---
name: pathway-json-builder
description: >
  Convert an approved Prism pathway research brief (markdown) into a validated
  Prism pathway JSON file ready for upload via the Prism Admin Dashboard.
  Use whenever the user asks to "build the JSON", "generate the pathway JSON",
  "convert the brief", "build the pathway", or similar AFTER a research brief
  exists (typically from pathway-research), or when the user provides a
  markdown brief and asks for the JSON. Validates with the REAL import
  validator from apps/pathway-service (run via ts-node), so passing here means
  the import endpoint passes. Do NOT use for research — it consumes an existing
  brief; if none exists, run pathway-research first.
---

# Pathway JSON Builder

Convert an approved research brief into a fully valid Prism pathway JSON. The conversion is
deterministic: walk the brief's numbered sections in order, emit nodes and edges by fixed
rules, validate with the real import validator, fix, deliver. **Never invent clinical
content** — only restructure what the reviewed brief contains. If the brief is ambiguous in
a way that changes the output, stop and ask.

## Step 1 — Locate and read the brief

In order: the brief the conversation points at; else the most recent
`pathways/briefs/*-research-brief.md`; else a brief pasted in chat. Read it fully. If none
exists, offer to run `pathway-research`.

## Step 2 — Read the format spec and check for schema drift against origin/main

**Build and validate from a branch based on current `origin/main`.** The validator CLI
imports pathway-service source from *this checkout*, so a branch that is behind main
validates against a stale validator — which is exactly how two pathways once passed here
with 0 errors and then failed main's import with 4 errors each. `validate-pathway.ts`
refuses to run (exit 3) when HEAD does not contain `origin/main`; if it does, rebase, or
create a throwaway worktree from `origin/main` and build there.

Read `references/pathway-json-format.md` end-to-end — it is the authoritative spec and maps
brief sections to JSON constructs. Then run its **drift check**, which compares the spec's
stamp to **`origin/main`**, never to local HEAD (local HEAD is what goes stale):

```bash
git fetch origin
git log -1 --format=%h origin/main -- apps/pathway-service/src/services/import apps/pathway-service/src/services/resolution apps/pathway-service/src/types
```

If the hash differs from the one in the spec's header, run
`git diff <stamped-hash> origin/main -- <those paths>`, fold any enum/rule changes into your
generation, tell the user what changed, and update the spec (including its header hash).
This is how the pipeline absorbed the temporal-horizon evaluator kernel (spec v4) and PR #55's
decision semantics (spec v5) — the same procedure covers whatever lands next.

## Step 3 — Generate the JSON

Follow the spec exactly. Brief-section → JSON mapping:

- §1 → `pathway` metadata (category enum verbatim); §1b → `pathway.code_sets`.
- §2 Stages → Stage nodes + `root → HAS_STAGE` (except stages the brief marks branch-entry
  only). §3 Steps → Step nodes + `HAS_STEP`.
- §4 DPs → DecisionPoint (+`branch_mode`) + `HAS_DECISION_POINT` from the named step;
  criteria → Criterion + `HAS_CRITERION`; each criterion's target → `SELECTS_BRANCH`; the
  DP's distinct targets → `BRANCHES_TO`.
- §4b Gates → Gate nodes, `HAS_GATE` from "Attached to", `BRANCHES_TO` to the target.
  Emit conditions exactly as the brief specifies (attribute vs coded form, operator params);
  don't silently "correct" attribute spellings — flag suspected drift in the delivery
  message instead. **Emit `on_unresolved` on every chart gate**: the brief's §4b "On
  unresolved" value on a gate with a scalar (lab/vital threshold) condition — if an older
  brief has no such field, emit `ask` (main's own default, so no behaviour change) and list
  the gate in the delivery message as needing a clinical call; `default` on a gate with no
  scalar condition (the engine never asks there). Wildcards: only a trailing `.*` (`G82.2.*`); rewrite a
  brief's `G82.2*` to `G82.2.*` and note it — any other `*` is a literal that matches
  nothing. Emit `display` on every lab condition
  (readable name + unit) — it is the missing-value prompt. Never emit `prompt` on a chart
  gate. **`default_behavior` is `skip` on every single-target gate**: `traverse` includes the
  target on a definite "no" too, so the gate excludes nothing. If a brief asks for `traverse`
  to keep content reachable when data is missing, emit `skip` + `on_unresolved: ask` and
  flag it — "include on missing, exclude on normal" is not expressible on main. `[BLOCKED — prior_node_result]` gates: emit the brief's named fallback,
  never the prior_node_result gate itself; list the substitution in the delivery message.
  **Gate wiring (see the spec's Gate wiring box — the validator does NOT catch these):**
  (1) a Step behind a gate gets **no** `stage-N HAS_STEP` edge, and nothing else may
  `BRANCHES_TO`/`SELECTS_BRANCH` into it — otherwise the gate is inert and excludes
  nothing; (2) never point two gates at the same target — that is a race the *losing*
  gate wins, and gates do not OR. If the brief maps two mutually exclusive gates onto one
  target (e.g. trimester-specific thresholds), that is a brief ambiguity — stop and ask
  whether to merge them into one gate or split the target; (3) a chart gate
  (`patient_attribute`/`compound`) gets exactly **one** `BRANCHES_TO` — main rejects more.
  If the brief names several targets for one gate, it means fan-out: same-stage → one
  branch-entry-only Stage holding the steps (mandatory for question gates, which must not be
  duplicated); cross-stage → one identical-condition copy per target (`gate-x-<suffix>`).
  Emit `properties.when` only when the brief gives a real per-answer routing table (yes → A,
  no → B), and then map every answer.
- §5 Meds → Medication (+`clinical_role` only when the brief gives one; dose/frequency/
  duration/route as given) + `USES_MEDICATION` from the named step; escalations →
  `ESCALATES_TO`.
- §6/§7/§8/§9 → LabTest/`HAS_LAB_TEST`, Imaging/`HAS_IMAGING` (modality required),
  Procedure/`HAS_PROCEDURE`, Guidance/`HAS_GUIDANCE`.
- §10/§11 → QualityMetric/`HAS_QUALITY_METRIC`, Schedule/`HAS_SCHEDULE`.
- §12 → `REQUIRES` edges (dependent → prerequisite, exactly as written).
- §13 → CodeEntry + `HAS_CODE` from the named host. Legal hosts only (Step, Criterion,
  Medication, LabTest, Imaging, Procedure) — if the brief attaches a code to a Gate or
  Guidance, reattach to the gate's branch-target Step / the Guidance's host Step and note
  the substitution.
- §15 → EvidenceCitation nodes; §16 → `CITES_EVIDENCE` per mapped pair. Legal sources only —
  evidence mapped to a Gate/QM/Schedule/CodeEntry attaches to its host Step instead (note it).
- §17 temporal table → emit `horizon`/`status` onto the named conditions exactly as
  tabulated. **Builder-enforced temporal rules** (import accepts the keys but defers
  value/conflict validation to session preflight, where a violation aborts session
  creation): (1) never emit both `window_days` and `horizon` on one condition; (2)
  `horizon` ∈ LIFETIME|YEAR|QUARTER|MONTH|WEEK|DAY|ENCOUNTER or `{days: 1..36525}`;
  (3) `status` ∈ active|inactive|any; (4) `window_days` positive integer ≤ 36525; (5) every
  `vitals` condition (coded or `vitals.*`) gets an explicit horizon — `"DAY"` when §17 gives
  none, never `ENCOUNTER`: an omitted vitals horizon inherits ENCOUNTER and rejects every
  simulator session (no `encounterStart`) for every pathway it co-matches. A §17
  row conflicting with the gate's §4b `window_days` is a brief ambiguity — stop and ask.
  **Baseline drift (see the spec's box):** never emit a `trend_up`/`trend_down` gate as a
  single long `window_days` when the brief's §4b names a physiologic drift for that value.
  Layer the same trend at short/mid/long lookbacks under `OR`, tier `slope_threshold` so
  the short window demands the brisk early rate, and add the absolute-target condition when
  the brief gives a target. A lone long window inverts the verdict for any patient whose
  pre-treatment value sits inside it.
- §14 does NOT go in the JSON — restate it in the delivery message as the attribute-map
  seeding checklist. §18 is review-only.
- Use the brief's/spec's ID conventions; keep IDs stable across versions where content is
  unchanged (diff-friendly re-imports).

## Step 4 — Validate with the real import validator

```bash
npx ts-node --transpile-only .claude/skills/pathway-json-builder/scripts/validate-pathway.ts pathways/json/<logical_id>.json
```

(One-time per checkout: `npm ci` at repo root if ts-node is missing.) The CLI imports
`validatePathwayJson` from pathway-service source — the exact code the import endpoint runs
**on main, provided this checkout contains origin/main** (the CLI checks, and exits 3 if
not). Exit 0 = valid; 1 = errors listed; fix and re-run until 0. Treat warnings as
review items: resolve orphan-node and DP-without-branches warnings yourself (they're almost
always missing edges); surface anything else in the delivery message.

Common errors → fixes: missing root HAS_STAGE for a non-branch-entry stage → add it;
"attribute namespace not registered" → the brief used a nonexistent namespace, re-map per
spec or ask; "unknown key on … condition" → a param landed on the wrong condition kind;
cycle reported as depth-exceeded → find the BRANCHES_TO/HAS_GATE edge pointing upstream;
code format mismatch → verify the code, fix or drop. Never deliver an invalid file; if the
error stems from brief ambiguity, ask rather than guess.

### Step 4b — Gate control (builder-enforced)

Then the gate-control check — **this one is not optional, and the validator above cannot
substitute for it**:

```bash
node .claude/skills/pathway-json-builder/scripts/check-gate-control.ts pathways/json/<logical_id>.json
```

(No install needed; Node runs the TS directly.) It enforces the two gate-wiring rules
statically: a gate target reachable by any competing route (Rule 1), two gates sharing
a target (Rule 2), and a chart gate with several targets or a router edge without `when`
(Rule 3). Exit 0 = clean; 1 = violations, each naming the offending edges. **Never
deliver a pathway with gate-control violations** — it will import cleanly, display
correctly in the canvas, and quietly recommend every gated treatment to every patient.
Fix by deleting the competing edge or merging the gates; if the brief's intent is genuinely
ambiguous, ask rather than guess.

## Step 5 — Deliver

Save to `pathways/json/<logical_id>.json` and send the file. Delivery message: pathway title
+ version; node counts by type; validator result ("passed the real import validator, N
warnings"); gate-control result ("passed check-gate-control.ts, N gates / N gated targets")
plus any gate re-wiring done to satisfy Rules 1–3; code_sets emitted (how many); every substitution made (gate evidence → host
step, blocked-gate fallbacks, code reattachments); every gate given `on_unresolved: ask` by
default for want of a brief decision; the §14 attribute-map seeding checklist
(if any — these rows must exist in `pathway_attribute_code_map` before the gates evaluate);
any drift-check findings; and a reminder to upload via the Prism Admin Dashboard
(NEW_PATHWAY / NEW_VERSION / DRAFT_UPDATE per the spec's Upload section).
