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

> ## ⚠ The brief is the source of truth — never change a pathway JSON without its brief
>
> **Josh's rule: "We shouldn't change a pathway without updating the doc."** The research
> brief (`pathways/briefs/<logical_id>-research-brief.md`) is the source of truth; the JSON
> (`pathways/json/<logical_id>.json`) is derived from it. So:
>
> 1. **Every change to a pathway JSON — a fix, a re-wire, a version bump, a one-edge
>    deletion — updates its brief in the SAME commit**, saying what changed and why. Never
>    edit the JSON first and "catch the brief up later".
> 2. **Decisions are marked `[DECISION — Josh <YYYY-MM-DD>]`** in the brief, on the line
>    that states them, whenever Josh (or the reviewing physician) makes an authoring call.
> 3. **Every brief carries a stamp line** in its header (after the `# ` title, before the
>    first `## `), exactly one of:
>    ```
>    JSON: pathways/json/<logical_id>.json @ version <version>
>    JSON: (not built)
>    ```
>    `<version>` is the JSON's `pathway.version` verbatim (`"5"` → `5`), and §1's
>    `- **Version**:` must agree. Building or re-versioning the JSON updates the stamp.
>
> `scripts/check-brief-sync.ts` enforces this mechanically (every JSON has a brief, the
> stamp names it at its exact version, no stamp points at a missing JSON); it runs inside
> `validate-pathway.ts` (exit 4) and in the **pre-commit hook**, which also refuses a commit
> that stages `pathways/json/*.json` without its brief. See Step 4c.

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
This is how the pipeline absorbed the temporal-horizon evaluator kernel (spec v4), PR #55's
decision semantics (spec v5) and the evaluation pipeline (spec v6, 2026-10-03) — the same
procedure covers whatever lands next.

**The oracle is the `josh-dev` engine: `origin/main` plus josh-dev's authoring extensions**
(the spec header lists them). When main has moved, merge it into `josh-dev` *first*, re-run
the pathway-service suite and `scripts/gate-proof.ts`, and only then build. A JSON that uses
an extension validates here and fails on main — say so in the delivery whenever one is used.

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
  message instead. **Emit `on_unresolved` on every chart gate**: `ask` on every gate with a
  numeric condition (coded labs/vitals `greater_than`/`less_than`, or a `lab.*`/`vitals.*`/
  `patient.*` attribute other than `exists`) — **decided rule (Josh, 2026-09-24): numeric
  gates ask when the value is missing**, so this is not a clinical call to list; emit
  `default` on a numeric gate only when the brief carries `[ON-UNRESOLVED DEFAULT —
  <gate-id>]` (the gate-control check fails it otherwise); `default` on a gate with no
  numeric condition (the engine never asks there). Wildcards: only a trailing `.*` (`G82.2.*`); rewrite a
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
  nothing; the same holds for everything *under* the gated node: no `ESCALATES_TO` (or any
  other edge) from an ungated node into it, and no LabTest/Medication/… node shared with a
  host outside the gate — emit one node per host; (2) never point two gates at the same target — that is a race the *losing*
  gate wins, and gates do not OR. If the brief maps two mutually exclusive gates onto one
  target (e.g. trimester-specific thresholds), that is a brief ambiguity — stop and ask
  whether to merge them into one gate or split the target; (3) a chart gate
  (`patient_attribute`/`compound`) gets exactly **one** `BRANCHES_TO` — main rejects more.
  If the brief names several targets for one gate, it means fan-out: same-stage → one
  branch-entry-only Stage holding the steps (mandatory for question gates, which must not be
  duplicated; give it a unique `stage_number` = parent + 0.5, e.g. `1.5` — duplicate stage
  numbers fail the gate-control check); cross-stage → one identical-condition copy per target (`gate-x-<suffix>`).
  Emit `properties.when` only when the brief gives a real per-answer routing table (yes → A,
  no → B), and then map every answer.
- §5 Meds → Medication (+`clinical_role` only when the brief gives one; dose/frequency/
  duration/route as given) + `USES_MEDICATION` from the named step; escalations →
  `ESCALATES_TO` — **except into a gated region**: an `ESCALATES_TO` from an ungated med
  into a med behind a gate walks past the gate (anemia's IV-iron leak). There the gated
  step is the escalation route; omit the edge and say so in the delivery message.
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
  (3) `status` ∈ active|inactive|any, and never on labs/vitals (preflight error);
  (4) `window_days` positive integer ≤ 36525; (6) every condition gets an explicit
  `horizon` or `window_days` — when §17 is silent, emit the field's v1 default (LIFETIME
  for conditions/meds/allergies, QUARTER for labs, DAY for vitals) and list it; (5) every
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
not). It then runs `check-brief-sync.ts` on the same file (Step 4c). Exit 0 = valid and
in sync with the brief; 1 = errors listed; 4 = valid but the brief's stamp does not
describe this JSON (update the brief, then its stamp); fix and re-run until 0. Treat warnings as
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
statically: a gated target — **or anything it contains** — reachable by any competing
route (Rule 1: the engine walks every outgoing edge of an included node, so an action
edge like `ESCALATES_TO` or a LabTest shared with a host outside the gate is a second
route; `REQUIRES`-only routes warn; `[SECOND ROUTE — <node> via <source>]` in the brief
turns an intended one into an info line), two gates sharing
a target (Rule 2), and a chart gate with several targets or a router edge without `when`
(Rule 3), plus the condition lints (horizons, wildcards, `on_unresolved` — a numeric gate
set to `default` fails unless the brief carries its marker). It finds the brief at
`pathways/briefs/<logical_id>-research-brief.md`; pass `--brief <path>` if it lives
elsewhere. Exit 0 = clean; 1 = violations, each naming the offending edges. **Never
deliver a pathway with gate-control violations** — it will import cleanly, display
correctly in the canvas, and quietly recommend every gated treatment to every patient.
Fix by deleting the competing edge or merging the gates; if the brief's intent is genuinely
ambiguous, ask rather than guess.

To prove what a gate or DecisionPoint actually does for a patient, run the real engine with
`npx ts-node --transpile-only .claude/skills/pathway-json-builder/scripts/gate-proof.ts
[proof]` (no DB; replays branch choices the way the live mutation does). Add a proof there
when a brief decision hinges on runtime behaviour.

After changing `check-gate-control.ts`, `check-brief-sync.ts` or `validate-pathway.ts`'s
DATA USE checks, run their regression cases:
`node .claude/skills/pathway-json-builder/scripts/test-pipeline-checks.ts`
(fixtures in `scripts/fixtures/`, including the anemia ESCALATES_TO leak; the
validate-pathway cases run under ts-node, so `npm ci` first).

### Step 4c — Brief sync (builder-enforced)

```bash
node .claude/skills/pathway-json-builder/scripts/check-brief-sync.ts            # whole repo
node .claude/skills/pathway-json-builder/scripts/check-brief-sync.ts --json pathways/json/<logical_id>.json
```

(`validate-pathway.ts` already runs the `--json` form.) It fails when a JSON has no brief,
the brief has no stamp / a malformed or duplicate one / `(not built)`, the stamp names
another JSON or version, §1's `**Version**` disagrees with the stamp, a stamp names a
JSON that does not exist, or a JSON's `logical_id` differs from its filename. An unstamped
brief with no JSON only warns (a draft; stamp it `JSON: (not built)`). A brief is found by
the JSON path in its stamp, else by name (`<logical_id>-research-brief.md`).

When you build a new version: bump §1's Version, record why in the brief (with
`[DECISION — Josh <date>]` where he decided it), set the stamp to the new version, set the
JSON's `pathway.version` — then commit the brief and the JSON **together**.

**Pre-commit hook.** `scripts/pre-commit-brief-sync.sh` blocks a commit that stages any
`pathways/json/*.json` without its brief, or whose staged tree fails `check-brief-sync.ts
--staged` (it checks the index, not the working tree, so a fix left unstaged does not
count). It does nothing when no `pathways/` file is staged. Install once per clone — it
goes in the common hooks directory, so every worktree shares it, and it is a no-op on any
branch that does not carry the script:

```bash
sh .claude/skills/pathway-json-builder/scripts/install-pre-commit-hook.sh
```

The installer writes a small dispatcher to `$(git rev-parse --git-common-dir)/hooks/pre-commit`
that runs `<worktree top>/.claude/skills/pathway-json-builder/scripts/pre-commit-brief-sync.sh`
if that file exists (each branch runs its own copy). It refuses to overwrite a different
pre-commit hook, and warns when `core.hooksPath` (shared or per-worktree) would bypass it.
Check it is live with `cat "$(git rev-parse --git-common-dir)/hooks/pre-commit"`. Bypass
once with `git commit --no-verify` only when Josh says so.

## Step 5 — Deliver

Save to `pathways/json/<logical_id>.json` **and update the brief's stamp line in the same
change**, and send the file. Delivery message: pathway title
+ version; node counts by type; validator result ("passed the real import validator, N
warnings"); gate-control result ("passed check-gate-control.ts, N gates / N gated targets")
plus any gate re-wiring done to satisfy Rules 1–3; code_sets emitted (how many); every substitution made (gate evidence → host
step, blocked-gate fallbacks, code reattachments); every numeric gate the brief exempted
from `ask` via an `[ON-UNRESOLVED DEFAULT]` marker; the §14 attribute-map seeding checklist
(if any — these rows must exist in `pathway_attribute_code_map` before the gates evaluate);
any drift-check findings; every horizon defaulted for want of a §17 row; every
trend/delta/count gate flagged "simulator-untestable (needs dated facts)"; and a reminder to upload via the Prism Admin Dashboard
(NEW_PATHWAY / NEW_VERSION / DRAFT_UPDATE per the spec's Upload section).
