<!--
Thanks for contributing to Ring! Keep the summary focused on user-facing behavior.
See CONTRIBUTING.md for the full workflow.
-->

## What & why

<!-- What does this change do, and why? Link any issue. -->

## Checklist

- [ ] Targets `develop` (not `main`).
- [ ] `npm run build` passes (typecheck + bundle).
- [ ] `npm run test:unit` passes; added/updated unit tests where it made sense.
- [ ] `cd server && go test ./...` passes; added/updated `_test.go` where it made sense.
- [ ] `npm run test:e2e` run if this affects user-facing flows (or N/A).
- [ ] Commits follow Conventional Commits with a scope (e.g. `feat(call): …`).

## Zero-knowledge invariant

<!--
Required if this touches the client/server boundary (anything on the wire, storage,
sync, push, or media). The server must never see plaintext.
-->

- [ ] This change does **not** require the server to read user plaintext, **or** it
      does not touch the client/server boundary.
- Notes: <!-- how the server stays blind to plaintext, if relevant -->
