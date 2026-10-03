# Prism Clinical Pathway Skill Pipeline

Project skills (auto-discovered by Claude Code from `.claude/skills/`) that take a clinical
condition from deep guideline research to an upload-ready Prism pathway JSON:

```
condition ──▶ pathway-research ──▶ markdown brief ──▶ physician review/edit
                                                            │
             pathways/json/<id>.json ◀── pathway-json-builder ◀── approved brief
             (upload via Admin Dashboard)
```

| Skill | Does | Output |
|---|---|---|
| `pathway-research` | Multi-agent deep research across US society guidelines; drafts a structured, citation-verified brief matching the JSON schema 1:1 | `pathways/briefs/<logical_id>-research-brief.md` |
| `pathway-json-builder` | Deterministic brief→JSON conversion, validated by the **real** import validator (imported from `apps/pathway-service` source via ts-node) | `pathways/json/<logical_id>.json` |
| `pathway-batch` | Orchestrates the two above for 2–3 conditions with a resumable manifest | both, per condition |

Design principles:

- **The repo is the schema oracle.** The format spec
  (`pathway-json-builder/references/pathway-json-format.md`) is generated from
  pathway-service source and stamps the `origin/main` commit it reflects; the builder runs
  a git drift check **against `origin/main`** (never local HEAD) on every build and updates
  the spec when the schema moves. Validation runs the actual `validatePathwayJson` from the
  checkout — so build from a branch based on current `origin/main`; the validator CLI
  refuses to run (exit 3) on a checkout that does not contain it.
- **Humans review prose, machines get JSON.** Research output is a markdown brief the
  physician reviews and edits; JSON is only generated from an approved brief and never
  invents content.
- **Current ability, tracked by drift check.** The temporal-horizon evaluator kernel
  merged 2026-08-13 and the pipeline absorbed it the same day (spec v4): per-condition
  `horizon`/`status` are now first-class authoring surface, with the builder enforcing the
  preflight-owned rules import doesn't check (window_days XOR horizon, value grammars).
  Briefs carry a temporal-audit table (§17) so time semantics get physician review in one
  place. PR #55's decision semantics (multi-target routing, `on_unresolved`, required
  `branch_mode`) were absorbed as spec v5 on 2026-09-24, and main's evaluation pipeline
  (PRs #56–#61: sessions store inputs; every answer re-evaluates the whole pathway) as
  spec v6 on 2026-10-03, when main was merged into `josh-dev` and `gate-proof.ts` was
  moved onto it. The same drift-check procedure absorbs whatever lands on main next.
- **Lockstep means three things agree:** the engine on `josh-dev` (main + josh-dev's
  extensions), the format spec, and `scripts/gate-proof.ts`. A change to any one is not
  done until the other two pass against it.

Requirements: `npm ci` at the repo root once per checkout (for ts-node), and web access for
the research skill.

History: these skills supersede the claude.ai-hosted `pathway-research` /
`pathway-json-builder` / `pathway-batch` skills (May–June 2026), which targeted a
pre-time-shape schema and taught attribute namespaces that now hard-fail import. Remove
those from claude.ai to avoid double-triggering — as of 2026-09-24 they are still installed
(`anthropic-skills:pathway-research` / `-json-builder` / `-batch`), and pathways stored on
the local gateway still show their older shapes.
