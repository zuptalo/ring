#!/usr/bin/env bash
#
# Apply (and re-apply) Ring's protected-branch ruleset to main.
#
# `main` is the ONLY long-lived branch: short-lived feature branches PR straight
# into it and every merge ships (see CONTRIBUTING.md). There is nothing else to
# protect.
#
# WHAT IT ENFORCES on each branch:
#   - Pull request required before merging (0 required approvals — we're a solo
#     maintainer and GitHub won't let you approve your own PR; raise this once there
#     are other maintainers).
#   - Required status checks (non-strict): the aggregate "CI gate" plus the always-on
#     roadmap + release guards (see REQUIRED_CHECKS). NON-strict on purpose: requiring
#     "up to date before merge" makes every merge invalidate other in-flight PRs and
#     forces a ~33-minute re-run for an unrelated change. The trade-off is that two
#     open PRs can both bump to the same version and both pass the release guard; the
#     second to merge then fails LOUDLY in release.yml's preflight (which refuses to
#     "release" an already-shipped tag unless explicitly told to) rather than shipping
#     nothing quietly. Merging one PR at a time avoids it; see ci.yml's release-guard.
#   - Conversation resolution required.
#   - Force-pushes and branch deletion blocked.
#   - enforce_admins: rules apply to admins too (no bypass).
#   - Linear history NOT required (so each PR keeps its merge commit, which
#     release.yml verifies and tags).
#
# It also flips three REPO-LEVEL settings: allow_auto_merge (so the Auto-merge
# workflow can schedule any green PR to merge itself), allow_merge_commit, and
# delete_branch_on_merge (auto-delete merged feature branches; protected main is
# exempt via allow_deletions:false, so it is never auto-deleted).
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
BRANCHES=(main)

# Required status check contexts.
#
# The heavy build/test/e2e jobs (the `verify` caller of build-test.yml) are
# CONDITIONALLY SKIPPED for doc/spec/tooling-only changes (see the `changes` job in
# ci.yml). A skipped check that is *required* would block the PR forever, so we must
# NOT require the individual "verify / *" contexts. Instead we require "CI gate" —
# an always-running aggregate that passes when every upstream job succeeded or was
# intentionally skipped, and fails if any actually failed. That keeps doc-only PRs
# unblocked while still enforcing the full suite whenever code changes.
#
# "Roadmap up to date" and "Release guard (version bump)" are top-level ci.yml jobs
# that always run (cheap), so they are required directly too. Every PR targets main
# and every merge ships, so the release guard now enforces a version bump on all of
# them.
#
# IMPORTANT: run this script only AFTER the ci.yml that defines "CI gate" has merged,
# or PRs will require a check that doesn't exist yet.
REQUIRED_CHECKS=(
  "CI gate"
  "Roadmap up to date"
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
  required_status_checks: { strict: false, checks: $checks },
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
#   - allow_auto_merge: lets the Auto-merge workflow schedule every non-draft PR to
#     merge itself the moment the required checks pass, so a proven change is not
#     sitting behind a click. Protection still gates the merge.
#   - allow_merge_commit: a PR must land as a MERGE COMMIT (release.yml verifies it).
#   - delete_branch_on_merge: auto-delete a PR's head branch once it merges, so
#     stale feature branches don't pile up. SAFE here: main is protected with
#     allow_deletions:false, so it is never auto-deleted — only the unprotected
#     feature branches get cleaned up.
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
echo "  gh api repos/${REPO}/branches/main/protection | jq ."
