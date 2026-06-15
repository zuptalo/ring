#!/usr/bin/env bash
#
# Ring's canonical spec creator — the one entry point for starting any work item.
#
# Why this exists: /speckit-specify computes the spec directory name itself
# (plain 3-digit sequential) and only runs create-new-feature.sh through an
# optional hook. Ring needs category-banded numbers (planned 0001+, ad-hoc
# 1001+, hotfix 2001+), so number allocation has to live in a tracked script the
# workflow always calls — not in the agent-local skill. This wrapper allocates
# the banded number, creates the feature branch and specs/<NNNN-slug>/spec.md
# from the template, and records the directory in .specify/feature.json so every
# downstream speckit command (/speckit-specify, /speckit-plan, /speckit-tasks,
# …) operates on it in place rather than minting a fresh sequential directory.
#
# Usage:
#   scripts/spec-new.sh <planned|adhoc|hotfix> "<short feature description>" [extra flags]
#
# Examples:
#   scripts/spec-new.sh planned "Add full-text message search"
#   scripts/spec-new.sh hotfix  "Fix call drop on network reconnect"
#   scripts/spec-new.sh adhoc   "Refresh the update toast copy" --short-name "toast-copy"
#
# After it runs, fill the spec content with /speckit-specify (it reads
# .specify/feature.json and writes into the directory created here — do not let
# it create a new one), then continue the pipeline:
#   clarify → plan → tasks → analyze → taskstoissues → implement.
set -euo pipefail

CATEGORY="${1:-}"
DESC="${2:-}"

case "$CATEGORY" in
    planned|adhoc|hotfix) ;;
    *)
        echo "Usage: $0 <planned|adhoc|hotfix> \"<short feature description>\" [extra flags]" >&2
        echo "  planned  -> spec numbers 0001-0999 (roadmap features)" >&2
        echo "  adhoc    -> spec numbers 1001-1999 (unplanned but deliberate work)" >&2
        echo "  hotfix   -> spec numbers 2001+      (bug fixes / hotfixes)" >&2
        exit 1
        ;;
esac

if [ -z "$DESC" ]; then
    echo "Error: a short feature description is required as the second argument" >&2
    exit 1
fi

shift 2 || true   # remaining args ($@) pass straight through to create-new-feature.sh

REPO_ROOT="$(CDPATH="" cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CREATE="$REPO_ROOT/.specify/scripts/bash/create-new-feature.sh"

if [ ! -x "$CREATE" ] && [ ! -f "$CREATE" ]; then
    echo "Error: $CREATE not found. Is spec-kit initialized (.specify/)?" >&2
    exit 1
fi

# create-new-feature.sh creates the branch + specs/<dir> + spec.md and prints JSON.
# Note: BRANCH_NAME may carry a GitFlow type prefix (feat/…, fix/…) while the spec
# directory is always flat, so derive the directory from SPEC_FILE, not BRANCH_NAME.
OUT="$(bash "$CREATE" --json --category "$CATEGORY" "$@" "$DESC")"

json_field() {
    local key="$1"
    if command -v jq >/dev/null 2>&1; then
        printf '%s' "$OUT" | jq -r ".$key"
    elif command -v python3 >/dev/null 2>&1; then
        printf '%s' "$OUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('$key',''))"
    else
        printf '%s' "$OUT" | sed -E "s/.*\"$key\":\"([^\"]*)\".*/\1/"
    fi
}

BRANCH_NAME="$(json_field BRANCH_NAME)"
SPEC_FILE="$(json_field SPEC_FILE)"

if [ -z "$SPEC_FILE" ]; then
    echo "Error: could not determine the new spec directory from create-new-feature.sh output:" >&2
    echo "$OUT" >&2
    exit 1
fi

# The flat spec directory is the parent of spec.md (e.g. specs/0001-foo).
SPEC_DIR_ABS="$(dirname "$SPEC_FILE")"
SPEC_DIR_REL="specs/$(basename "$SPEC_DIR_ABS")"

# Record the feature directory so the speckit slash commands resolve it without
# relying on git-branch-name conventions.
printf '{\n  "feature_directory": "%s"\n}\n' "$SPEC_DIR_REL" > "$REPO_ROOT/.specify/feature.json"

echo ""
echo "Created spec: $SPEC_DIR_REL/spec.md   (branch: $BRANCH_NAME, category: $CATEGORY)"
echo "Recorded .specify/feature.json -> $SPEC_DIR_REL"
echo ""
echo "Next: /speckit-specify to fill the spec, then clarify → plan → tasks → analyze → taskstoissues → implement."
