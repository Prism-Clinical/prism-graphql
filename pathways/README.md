# Pathway Pipeline Outputs

Artifacts produced by the `.claude/skills/` pathway pipeline:

- `briefs/` — research briefs (`<logical_id>-research-brief.md`) awaiting or reflecting
  physician review. Edit these directly; the JSON builder consumes the edited file.
- `json/` — validated pathway JSON (`<logical_id>.json`) ready for upload via the Prism
  Admin Dashboard.

**The brief is the source of truth; the JSON is derived from it.** Never change a JSON
without updating its brief in the same commit. Each brief's header carries one stamp line —
`JSON: pathways/json/<logical_id>.json @ version <version>`, or `JSON: (not built)` — and
`node .claude/skills/pathway-json-builder/scripts/check-brief-sync.ts` fails when any JSON
and its brief disagree (details in `.claude/skills/pathway-json-builder/SKILL.md`).

A `.batch-manifest.json` may appear here transiently while `pathway-batch` is mid-flight;
it is the batch's resume state and is deleted on completion.
