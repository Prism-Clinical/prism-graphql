#!/bin/sh
# .claude/skills/pathway-json-builder/scripts/install-pre-commit-hook.sh
#
# Installs the pathway brief-sync pre-commit hook for this clone:
#   sh .claude/skills/pathway-json-builder/scripts/install-pre-commit-hook.sh
#
# Git worktrees share ONE hooks directory (`git rev-parse --git-common-dir`/hooks),
# so a hook there runs in every worktree, on every branch. What is installed is
# therefore a small DISPATCHER, not the check itself: it runs
#   <worktree top>/.claude/skills/pathway-json-builder/scripts/pre-commit-brief-sync.sh
# only when the checked-out branch carries that file, and exits 0 otherwise — so
# branches without the pipeline (engine work, main) commit exactly as before, and
# each branch runs its own version of the check.
#
# Safe to re-run (it replaces only its own dispatcher). It refuses to overwrite a
# different pre-commit hook, and warns when core.hooksPath would bypass it.

set -eu

MARK="prism-pathway-brief-sync dispatcher v1"
common=$(git rev-parse --git-common-dir)
common=$(cd "$common" && pwd)
hooks="$common/hooks"
hook="$hooks/pre-commit"

if [ -e "$hook" ] && ! grep -q "prism-pathway-brief-sync dispatcher" "$hook"; then
  echo "✗ $hook already exists and is not ours — not overwriting it." >&2
  echo "  Add this line to it instead (it is a no-op on branches without the script):" >&2
  echo '    top=$(git rev-parse --show-toplevel); s="$top/.claude/skills/pathway-json-builder/scripts/pre-commit-brief-sync.sh"; [ ! -f "$s" ] || sh "$s" || exit 1' >&2
  exit 1
fi

mkdir -p "$hooks"
cat > "$hook" <<EOF
#!/bin/sh
# $MARK
# Installed by .claude/skills/pathway-json-builder/scripts/install-pre-commit-hook.sh.
# Shared by every worktree of this clone. Runs the checked-out branch's own
# pathway brief-sync check if the branch has it; otherwise does nothing.
top=\$(git rev-parse --show-toplevel 2>/dev/null) || top=\$(pwd)
script="\$top/.claude/skills/pathway-json-builder/scripts/pre-commit-brief-sync.sh"
[ -f "\$script" ] || exit 0
exec sh "\$script" "\$@"
EOF
chmod +x "$hook"
echo "✓ installed $hook"

# core.hooksPath (shared, per-worktree, or global) makes git ignore $hooks entirely.
warn=0
if hp=$(git config --get core.hooksPath 2>/dev/null) && [ -n "$hp" ]; then
  echo "⚠ core.hooksPath=$hp is set for this worktree — git will NOT run $hook here." >&2
  warn=1
fi
git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r wt; do
  [ -d "$wt" ] || continue
  if hp=$(git -C "$wt" config --get core.hooksPath 2>/dev/null) && [ -n "$hp" ]; then
    echo "⚠ worktree $wt sets core.hooksPath=$hp — the hook will not run there." >&2
  fi
done
[ "$warn" -eq 0 ] || exit 1
exit 0
