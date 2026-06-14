# Contributing to Ring

Thanks for your interest in Ring — a private, end-to-end-encrypted messenger and
calling app (an installable Vue 3 + Ionic PWA backed by a small Go server). This
guide covers how we branch, test, and ship. For the architecture and the
conventions behind the code, read [`CLAUDE.md`](CLAUDE.md) first — it is the map.

## License of contributions

Ring is licensed **AGPL-3.0-only** (see [`LICENSE`](LICENSE)). By submitting a
contribution you agree it is licensed under the same terms. The network-copyleft
clause (AGPL §13) is intentional: anyone running a modified Ring server over a
network must offer its source. Keep that in mind for anything that touches the
client/server boundary.

## The zero-knowledge invariant (read this)

The server only ever relays **sealed envelopes** and stores **opaque ciphertext** —
it never sees message bodies, contacts, profiles, or media. Every change that
crosses the client/server boundary must preserve this: encrypt on the client, send
ciphertext. A PR that would require the server to read user plaintext will not be
accepted. When in doubt, say how your change keeps the server blind.

## Local setup

Requires **Go 1.26, Node 22, Docker** (for the dev PostgreSQL).

```sh
npm install
make start      # PostgreSQL + ringd (air hot-reload) + Vite, all at once
```

The app comes up on http://localhost:5173 and proxies the API to `ringd` on `:8080`.
In dev the server seeds fixed invite codes (`RINGDEV1`..`RINGDEV9`, `TESTCODE`) so
you can register test accounts immediately.

## Branching model (GitFlow)

- **`develop`** is the integration branch — all work targets it.
- **`main`** is production — only `develop` is merged in, to cut a release.
- **Feature branches** branch off `develop` and open a PR back into `develop`.
  Name them descriptively, e.g. `feat/group-call-roster`, `fix/ios-audio-route`.

Both `develop` and `main` are protected: changes land **only via pull request with
all CI checks green** (see [the branch-protection setup](#branch-protection)).
Direct pushes are rejected.

## Making a change

1. Branch off the latest `develop`.
2. Make your change, matching the surrounding code (see Code style in `CLAUDE.md` —
   we favor explanatory comments on the *why*).
3. Run the gates locally (below). Add or update tests.
4. Open a PR into `develop`. Fill in the PR template, including the zero-knowledge
   confirmation for anything touching the wire.
5. Once CI is green, the PR can be merged. Your feature branch is deleted
   automatically on merge (the protected `develop`/`main` are never auto-deleted).

### Commit messages

Conventional Commits with a scope, e.g. `feat(call): …`, `fix(media): …`,
`feat(server): …`, `test(e2e): …`, `ci: …`, `docs: …`. The subject describes
user-facing behavior, not internals.

## Test gates (run before opening a PR)

These mirror exactly what CI runs (`.github/workflows/build-test.yml`):

```sh
npm run build                 # client: vue-tsc --noEmit (typecheck) THEN vite build
npm run test:unit             # client: Vitest unit tests (crypto core + pure logic)
cd server && go test ./...    # server unit tests (in-memory fake store, NO DB needed)
npm run test:e2e              # Playwright e2e (needs `make db-up`; spins its own ringd)
```

- Server tests need no database (in-memory fake store). Each handler file has a
  sibling `_test.go` — keep that pattern.
- The e2e harness resets a throwaway `ring_e2e` DB and launches an isolated test
  `ringd`; it does **not** touch your `make start` stack.

## Releases and release candidates

Releases are driven by `package.json` `version`:

- **Release:** bump the version on `develop`, then open a PR into `main`. Bump with
  the one-shot script (no manual editing, no local tag/commit — it just edits
  `package.json` + `package-lock.json` for you to commit):

  ```sh
  npm run release:patch    # 0.1.0 -> 0.1.1   (or release:minor / release:major)
  ```

  Open the PR using the **release PR template**
  ([`.github/PULL_REQUEST_TEMPLATE/release.md`](.github/PULL_REQUEST_TEMPLATE/release.md);
  add `?template=release.md` to the compose URL, or follow its shape if you open the
  PR via the API). List each user-facing change as a one-liner under **Changes**.

  On merge, the pipeline re-verifies the merge commit and — if green and the
  `vX.Y.Z` tag is new — tags `main`, publishes the production image (`latest`,
  `X.Y.Z`, `X.Y`), and cuts a GitHub release whose notes are the version plus one
  bullet per change (drawn from the Conventional-Commit subjects since the last
  tag — another reason to keep commit subjects clean).

  A release PR **without a version bump cannot be merged**: the CI check
  `Release guard (version bump)` fails it, because merging it would silently no-op
  the release (the tag already exists). The guard is green on every PR into
  `develop`, so it only matters for the `develop → main` PR.

  You don't merge the release PR by hand. The `Auto-merge release PRs` workflow
  turns on GitHub auto-merge for any PR into `main`, so GitHub merges it (as a
  merge commit) the moment the guard and the full suite are green — and not
  before. Open it and walk away; to cancel, just disable auto-merge on the PR.
  (This needs the repo-level "Allow auto-merge" setting, which
  `scripts/setup-branch-protection.sh` turns on.)

- **Release candidate:** push a `vX.Y.Z-rc.N` tag (off `develop`). It runs the full
  suite and publishes a single immutable `:X.Y.Z-rc.N` image + a GitHub pre-release.
  An RC never moves `:latest`/`:X.Y`.

### Optional: local release-bump reminder

Run `make hooks` once to opt in to the repo's git hooks
(`git config core.hooksPath scripts/hooks`). The advisory `pre-push` hook warns —
without ever blocking the push — when you push `develop` at a version that's already
been released, so you remember to bump before opening the release PR. CI's release
guard stays the real gate. Disable with `git config --unset core.hooksPath`.

Operator upgrade/rollback guidance lives in [`docs/UPGRADING.md`](docs/UPGRADING.md).

## Branch protection

The exact protected-branch ruleset is applied (and re-applied) with
[`scripts/setup-branch-protection.sh`](scripts/setup-branch-protection.sh). See that
script's header for what it enforces and the one prerequisite (an authenticated
`gh`). Note: GitHub requires a paid plan for branch protection on **private** repos;
it is free once a repo is public.
