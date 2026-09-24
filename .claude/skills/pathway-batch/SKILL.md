---
name: pathway-batch
description: >
  Orchestrate research and JSON generation for 2–3 Prism clinical pathways in
  one batch. Use whenever the user lists multiple clinical conditions and wants
  pathway documents — "create pathways for X, Y, Z", "batch of pathways",
  "build pathways for the following", or any request naming 2+ conditions.
  Drives pathway-research and pathway-json-builder in sequence: researches each
  condition, delivers each brief as it finishes, waits for approval, then
  builds the JSONs. Hard limit 3 conditions. Do NOT use for a single pathway
  (use pathway-research) or when briefs already exist and only JSON is needed
  (use pathway-json-builder).
---

# Pathway Batch Orchestrator

Run the two-skill pipeline across 2–3 conditions with a manifest tracking state across
turns. This skill adds orchestration only — all research standards, brief structure, and
JSON rules come from `pathway-research` and `pathway-json-builder`; read both SKILL.md
files before starting.

**Hard limit: 3 conditions.** If more are requested, take the first 3 (confirm which) and
tell the user to run another batch for the rest.

## Manifest

Maintain `pathways/.batch-manifest.json`:

```json
{
  "batch_started": "<ISO date>",
  "conditions": [
    { "condition": "...", "logical_id": "...", "status": "pending|researching|brief-delivered|approved|json-built", "brief": "pathways/briefs/....md", "json": null }
  ]
}
```

On invocation, check for an existing manifest first — if one is mid-flight, resume it
(report status, continue the next incomplete item) instead of starting over. Update the
manifest after every state change. Delete it when the batch fully completes.

## Flow

1. **Scope once, up front.** Confirm scope questions (per pathway-research Step 1) for ALL
   conditions in one message. Create the manifest.
2. **Research sequentially, deliver incrementally.** For each condition run the full
   pathway-research workflow (its own multi-agent fan-out included). Deliver each brief as
   it finishes — don't hold them for the end. Mark `brief-delivered`.
3. **Wait for approval.** After all briefs are delivered, summarize the batch (per-pathway
   counts, gaps, flags) and ask for review. JSON building starts only when the user
   approves — approval may be per-brief ("build A and C, I'm still editing B") or blanket;
   track it per condition in the manifest.
4. **Build JSONs** for approved briefs via the pathway-json-builder workflow (drift check
   once for the whole batch; real-validator run per file). Deliver each JSON with its own
   delivery message content (substitutions, attribute-map checklist), then a final batch
   summary. Mark `json-built`; delete the manifest when every condition is done.

If the session ends mid-batch, the manifest is the recovery point — the next invocation
picks up exactly where it left off.
