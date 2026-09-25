#!/bin/sh
# .claude/skills/pathway-json-builder/scripts/pre-commit-brief-sync.sh
#
# Pre-commit hook body: "We shouldn't change a pathway without updating the doc."
# Blocks the commit when
#   - any pathways/json/*.json is staged without its research brief, or
#   - the STAGED tree (the index, not the working tree) fails check-brief-sync.ts
#     (a JSON without a brief, a missing/stale version stamp, a stamp pointing at
#     a missing JSON, ...).
# Does nothing when no pathways/ file is staged, so commits elsewhere (apps/, ...)
# are never held up by pathway state.
#
# Installed by install-pre-commit-hook.sh as a dispatcher in the clone's common
# hooks dir, which runs THIS file from the checked-out worktree when it exists.
# Can also be run by hand: sh .claude/skills/pathway-json-builder/scripts/pre-commit-brief-sync.sh

top=$(git rev-parse --show-toplevel 2>/dev/null) || top=$(pwd)
cd "$top" || exit 1

# GIT_INDEX_FILE is inherited: under `git commit -a` / `git commit <paths>` git
# points it at a temporary index, and that is what is being committed.
if [ -z "$(git diff --cached --name-only -- pathways/)" ]; then
  exit 0
fi

check=".claude/skills/pathway-json-builder/scripts/check-brief-sync.ts"
if ! command -v node >/dev/null 2>&1; then
  echo "pre-commit (brief sync): pathways/ files are staged, but 'node' is not on PATH," >&2
  echo "  so $check cannot run. Fix PATH (Node >= 23), or commit with --no-verify only if Josh says so." >&2
  exit 1
fi

node "$check" --staged
status=$?
if [ "$status" -ne 0 ]; then
  echo "" >&2
  echo "pre-commit: commit blocked — a pathway JSON and its research brief are out of sync (above)." >&2
  echo "  The brief is the source of truth: update it in the same commit (and its" >&2
  echo "  'JSON: pathways/json/<id>.json @ version <v>' stamp if the version moved), then stage both." >&2
fi
exit "$status"
