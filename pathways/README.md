# Pathway Pipeline Outputs

Artifacts produced by the `.claude/skills/` pathway pipeline:

- `briefs/` — research briefs (`<logical_id>-research-brief.md`) awaiting or reflecting
  physician review. Edit these directly; the JSON builder consumes the edited file.
- `json/` — validated pathway JSON (`<logical_id>.json`) ready for upload via the Prism
  Admin Dashboard.

A `.batch-manifest.json` may appear here transiently while `pathway-batch` is mid-flight;
it is the batch's resume state and is deleted on completion.
