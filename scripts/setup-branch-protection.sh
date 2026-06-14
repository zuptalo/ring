#!/usr/bin/env bash
#
# Apply (and re-apply) Ring's protected-branch ruleset to develop and main.
#
# WHAT IT ENFORCES on each branch:
#   - Pull request required before merging (0 required approvals — we're a solo
#     maintainer and GitHub won't let you approve your own PR; raise this once there
#     are other maintainers).
#   - Required status checks, strict (branch must be up to date before merge):
#     the three jobs produced by the `verify` caller running build-test.yml.
#   - Conversation resolution required.
#   - Force-pushes and branch deletion blocked.
#   - enforce_admins: rules apply to admins too (no bypass).
#   - Linear history NOT required (so develop -> main keeps its merge commit).
#
# It also flips three REPO-LEVEL settings: allow_auto_merge (so the Auto-merge
# workflow can schedule the release PR), allow_merge_commit, and
# delete_branch_on_merge (auto-delete merged feature branches; protected develop/
# main are exempt via allow_deletions:false, so they're never auto-deleted).
#
# PREREQUISITES:
#   - An authenticated GitHub CLI: `gh auth status` must succeed, with a token that
#     has admin rights on the repo.
#   - Branch protection on a PRIVATE repo requires a paid GitHub plan (Pro/Team/
#     Enterprise). It is FREE once the repo is public. The API call below returns 403
#     ("Upgrade to GitHub Pro…") on a free private repo — that's the plan limit, not
#     a bug; run this after going public, or upgrade the plan.
#
# USAGE:
#   scripts/setup-branch-protection.sh                  # defaults to zuptalo/ring
#   REPO=owner/name scripts/setup-branch-protection.sh  # another repo
#   DRY_RUN=1 scripts/setup-branch-protection.sh         # print payloads, change nothing
#
# This is idempotent: the protection endpoint is a PUT, so re-running just restates
# the desired config.
set -euo pipefail

REPO="${REPO:-zuptalo/ring}"
BRANCHES=(develop main)

# Required status check contexts. These are "<caller-job> / <job name>" where the
# caller job is `verify` (in ci.yml / release.yml) and the names come from the jobs
# in .github/workflows/build-test.yml. If you rename a job, update it here too.
#
# "Release guard (version bump)" is a top-level job in ci.yml (not under `verify`),
# so it has no caller prefix. It reports green on PRs into develop and only enforces
# a version bump on PRs into main — safe to require on both branches.
REQUIRED_CHECKS=(
  "verify / Client (typecheck + build)"
  "verify / Client (unit tests)"
  "verify / Server (build + vet + test)"
  "verify / End-to-end (Playwright)"
  "Release guard (version bump)"
)

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh (GitHub CLI) not found on PATH." >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh is not authenticated. Run 'gh auth login' first." >&2
  exit 1
fi

# Build the required_status_checks.checks array from REQUIRED_CHECKS.
checks_json=$(printf '%s\n' "${REQUIRED_CHECKS[@]}" \
  | jq -R '{context: .}' | jq -s '.')

payload=$(jq -n --argjson checks "$checks_json" '{
  required_status_checks: { strict: true, checks: $checks },
  enforce_admins: true,
  required_pull_request_reviews: {
    required_approving_review_count: 0,
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false
  },
  restrictions: null,
  required_conversation_resolution: true,
  required_linear_history: false,
  allow_force_pushes: false,
  allow_deletions: false
}')

for branch in "${BRANCHES[@]}"; do
  echo "==> ${REPO}@${branch}"
  if [[ "${DRY_RUN:-}" == "1" ]]; then
    echo "$payload" | jq .
    continue
  fi
  echo "$payload" | gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "repos/${REPO}/branches/${branch}/protection" \
    --input - >/dev/null
  echo "    protection applied."
done

# Repo-level merge settings the release flow + housekeeping depend on:
#   - allow_auto_merge: lets the Auto-merge workflow schedule the develop -> main
#     PR to merge itself once required checks pass.
#   - allow_merge_commit: the release PR must land as a MERGE COMMIT (release.yml
#     verifies it; develop's history stays joined into main).
#   - delete_branch_on_merge: auto-delete a PR's head branch once it merges, so
#     stale feature branches don't pile up. SAFE here: develop and main are
#     protected with allow_deletions:false, so a develop -> main merge can never
#     delete develop — only unprotected feature -> develop branches get cleaned up.
echo "==> ${REPO} repo settings (auto-merge, merge commits, branch cleanup)"
if [[ "${DRY_RUN:-}" == "1" ]]; then
  echo '  { "allow_auto_merge": true, "allow_merge_commit": true, "delete_branch_on_merge": true }'
else
  gh api --method PATCH \
    -H "Accept: application/vnd.github+json" \
    "repos/${REPO}" \
    -F allow_auto_merge=true \
    -F allow_merge_commit=true \
    -F delete_branch_on_merge=true >/dev/null
  echo "    auto-merge + auto branch cleanup enabled."
fi

echo "Done. Verify in Settings -> Branches, or:"
echo "  gh api repos/${REPO}/branches/develop/protection | jq ."
