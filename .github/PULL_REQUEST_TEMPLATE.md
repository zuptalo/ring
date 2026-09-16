<!--
Thanks for contributing to Ring! Keep the summary focused on user-facing behavior.
See CONTRIBUTING.md for the full workflow.

`main` is the only long-lived branch, so MERGING THIS PR SHIPS A RELEASE: CI
re-verifies the merge commit, then tags main, publishes the production image
(latest, X.Y.Z, X.Y) and cuts a GitHub release. That is why the version bump below
is required — the "Release guard (version bump)" check fails any PR without one,
because merging it would ship nothing and say nothing.

The GitHub release notes are generated from the Conventional-Commit subjects
between the last tag and this merge, so clean commit subjects keep them clean.

Want it on real devices before production? Cut a release candidate off this branch
(git tag vX.Y.Z-rc.N && git push origin vX.Y.Z-rc.N) and merge once it checks out.
-->

## What & why

<!-- What does this change do, and why? Link any issue with `Closes #N`. -->

## Checklist

- [ ] Targets `main`, and `package.json` version bumped via
      `npm run release:{patch|minor|major}` to a new, unreleased version.
- [ ] `npm run build` passes (typecheck + bundle).
- [ ] `npm run test:unit` passes; added/updated unit tests where it made sense.
- [ ] `cd server && go test ./...` passes; added/updated `_test.go` where it made sense.
- [ ] `npm run test:e2e` run if this affects user-facing flows (or N/A).
- [ ] Commits follow Conventional Commits with a scope (e.g. `feat(call): …`).

## Shipping in this release

<!-- One user-facing one-liner per change. This is what the release is. -->

- 

## Zero-knowledge invariant

<!--
Required if this touches the client/server boundary (anything on the wire, storage,
sync, push, or media). The server must never see plaintext.
-->

- [ ] This change does **not** require the server to read user plaintext, **or** it
      does not touch the client/server boundary.
- Notes: <!-- how the server stays blind to plaintext, if relevant -->

## Notes / upgrade considerations

<!-- Anything operators should know (migrations, config, breaking changes). Delete if none. -->
