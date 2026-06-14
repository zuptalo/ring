<!--
RELEASE PR — develop → main.

Use this template for the PR that cuts a release (select it with
?template=release.md in the compose URL, or copy this shape if you're opening
the PR via the API). Merging this PR SHIPS a release: on merge, CI re-verifies
the merge commit and then tags main, publishes the production image
(latest, X.Y.Z, X.Y), and cuts a GitHub release.

Two hard requirements, both enforced by the "Release guard (version bump)" check:
  1. The base is `main` and the source is `develop`.
  2. package.json "version" was bumped on develop (run `npm run release:patch`,
     or :minor / :major) to a new, unreleased version. A PR without a bump
     cannot be merged — it would silently no-op the release.

The "## Changes" bullets below are what reviewers see is shipping. The GitHub
release notes are generated automatically from the Conventional-Commit subjects
between the last tag and this merge, so keeping commit subjects clean keeps the
release notes clean.

Auto-merge is enabled on this PR automatically: once the guard and the full CI
suite are green, GitHub merges it (merge commit) on its own. No need to click
merge; disable auto-merge on the PR if you want to hold it.
-->

## Release vX.Y.Z

<!-- Replace X.Y.Z with the bumped package.json version. -->

- [ ] Source is `develop`, base is `main`.
- [ ] `package.json` version bumped via `npm run release:{patch|minor|major}` to a new version.

## Changes

<!-- One user-facing one-liner per change shipping in this release. -->

- 

## Notes / upgrade considerations

<!-- Anything operators should know (migrations, config, breaking changes). Delete if none. -->
