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

## Branching model (trunk-based)

- **`main`** is the only long-lived branch. It is production *and* where work
  integrates — there is no `develop`.
- **Feature branches** branch off `main` and open a PR straight back into `main`.
  Name them descriptively, e.g. `feat/group-call-roster`, `fix/ios-audio-route`.
- **Every merge into `main` ships a release.** That is why each PR must carry a
  version bump (see [Releases](#releases-and-release-candidates)). A bug that
  reaches production is fixed like anything else — a branch, a PR, the next
  release — not by patching a long-lived release branch.
- **Want it on real devices before production?** Cut a
  [release candidate](#releases-and-release-candidates) off the feature branch and
  merge only once it checks out. Merging is shipping.

`main` is protected: changes land **only via pull request with all CI checks
green** (see [the branch-protection setup](#branch-protection)). Direct pushes are
rejected.

## Spec-driven development (required for new work)

Ring uses [Spec Kit](https://github.com/github/spec-kit). Anything that adds or
changes behavior starts as a **numbered spec** and moves through a fixed pipeline
before code is written. The governing principles live in
[`.specify/memory/constitution.md`](.specify/memory/constitution.md) — read it
once; it is the contract every spec is checked against (including the
non-negotiable zero-knowledge boundary).

**When this applies.** New features, behavioral changes, and non-trivial bug fixes
go through the full pipeline. Pure docs, comments, formatting, CI tweaks, and
one-line typo fixes do not need a spec — use judgement, and lean toward a spec
whenever a change has user-facing behavior or touches the wire.

### Spec numbers and categories

Each spec lives in `specs/<NNNN-slug>/` and the number encodes its category:

| Category  | Band       | What it's for                                  |
|-----------|------------|------------------------------------------------|
| `planned` | `0001–0999`| Roadmap features                               |
| `adhoc`   | `1001–1999`| Unplanned but deliberate work                  |
| `hotfix`  | `2001+`    | Bug fixes / hotfixes                           |

Create one with the tracked helper. It allocates the next free number in the band,
creates the **branch** (`feat/NNNN-slug` for planned/ad-hoc, `fix/NNNN-slug` for
hotfixes), creates the **flat** spec directory `specs/NNNN-slug/` (only the branch
carries the `feat/`·`fix/` prefix — the folder never does), and points the speckit
commands at it:

```sh
make spec CATEGORY=planned DESC="Add full-text message search"   # branch feat/0001-…
# or directly:
scripts/spec-new.sh hotfix "Fix call drop on network reconnect"  # branch fix/2001-…
```

Then follow this **required pipeline**, in order (the `/speckit-*` commands are
agent skills installed by `specify init`):

1. **`/speckit-specify`** — fill the spec content in the directory `spec-new.sh`
   created (it reads `.specify/feature.json`; don't let it mint a new directory).
2. **`/speckit-clarify`** — resolve ambiguity before planning.
3. **`/speckit-plan`** — produce the implementation plan and design docs.
4. **`/speckit-tasks`** — generate the ordered, dependency-aware task list. Tasks
   put failing tests **before** the implementation that satisfies them (TDD).
5. **`/speckit-analyze`** — cross-artifact consistency check. It only reports; if it
   flags something, fix the artifact at fault (spec, plan, **or** tasks) and re-run
   from there down. Must be clean (or findings explicitly waived) before implementing.
6. **`/speckit-taskstoissues`** — open one GitHub issue per task (title, body, and
   labels) in `zuptalo/ring`. Note the issue numbers for the PR.
7. **`/speckit-implement`** — work the tasks in order.

`/speckit-checklist` is **required** for any spec touching cryptography or the
zero-knowledge boundary, and optional otherwise.

As work progresses, bump the spec's **`**Status**:`** line
(`planned → in-progress → in-review → shipped`) — it drives the roadmap.

### ROADMAP.md is generated

[`ROADMAP.md`](ROADMAP.md) is **generated** from the specs — never hand-edit it.
Regenerate after adding a spec or changing a Status:

```sh
make roadmap        # == python3 scripts/roadmap-gen.py
```

CI's `Roadmap up to date` check fails the build if the committed `ROADMAP.md`
doesn't match `specs/`, so regenerate and commit it alongside your spec changes.

### Closing issues on merge

The feature → `main` PR **must reference every issue it implements** with a
closing keyword (`Closes #123`, one per line) so GitHub auto-closes them on merge.
This works because `main` is the repository's default branch — closing keywords
only fire on merges into the default branch.

## Making a change

1. Start a spec (`make spec …`) and run it through the pipeline above; it puts you
   on the feature branch.
2. Make your change, matching the surrounding code (see Code style in `CLAUDE.md` —
   we favor explanatory comments on the *why*).
3. Run the gates locally (below). Add or update tests (tests first, per TDD).
4. Bump the version — `npm run release:patch` (or `:minor` / `:major`) — and commit
   it with the change. Merging will ship it.
5. Open a PR into `main`. Fill in the PR template, including the zero-knowledge
   confirmation for anything touching the wire, and `Closes #N` for each issue.
6. Once CI is green, merge. That tags, publishes the production image, and cuts the
   GitHub release. Your feature branch is deleted automatically on merge (protected
   `main` is never auto-deleted), and the referenced issues close themselves.

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
- **Path-filtered CI:** a PR that changes only docs/specs/tooling (`**/*.md`,
  `specs/**`, `.specify/**`, `scripts/**`, `ROADMAP.md`) skips the heavy
  build/test/e2e suite — only the `Roadmap up to date` guard and the `CI gate`
  aggregate run. Any change under `src/`, `server/`, `e2e/`, deps, configs, the
  `Dockerfile`, or `.github/workflows/` runs the full suite. The single required
  check is **`CI gate`**, so doc-only PRs stay unblocked without it.

## Releases and release candidates

Releases are driven by `package.json` `version`:

> **Every merge into `main` is a release**, so **every PR into `main` carries a
> version bump.** There is no separate "cut a release" step and no release branch:
> the bump is part of the change. `Release guard (version bump)` fails any PR that
> doesn't move the version past `main`'s, because merging it would ship nothing and
> say nothing. This is manual by design — GitHub Actions can't open a bump PR (org
> policy forbids Actions from creating PRs).

- **Release:** bump the version on your feature branch, then open the PR into
  `main`. Bump with the one-shot script (no manual editing, no local tag/commit —
  it just edits `package.json` + `package-lock.json` for you to commit):

  ```sh
  npm run release:patch    # 0.1.0 -> 0.1.1   (or release:minor / release:major)
  ```

  On merge, the pipeline re-verifies the merge commit and — if green and the
  `vX.Y.Z` tag is new — tags `main`, publishes the production image (`latest`,
  `X.Y.Z`, `X.Y`) to GHCR and Docker Hub, and cuts a GitHub release whose notes are
  the version plus one bullet per change (drawn from the Conventional-Commit
  subjects since the last tag — another reason to keep commit subjects clean).

  **Merge one PR at a time.** Required checks are non-strict (a PR needn't be up to
  date with `main` to merge), so two open PRs can both bump to the *same* version
  and both pass the guard. The first to merge ships it; the second then fails
  loudly in `release.yml` — rebase it on `main` and bump again.

  **Optional auto-merge.** Add the **`auto-merge`** label to a PR and the
  `Auto-merge labelled PRs` workflow turns on GitHub auto-merge for it, so GitHub
  merges it (as a merge commit) the moment the guard and the full suite are green —
  and not before. Useful when you don't want to babysit a ~33-minute suite. Without
  the label nothing merges itself, which is the default on purpose: every merge
  ships. To cancel, disable auto-merge on the PR or remove the label. (This needs
  the repo-level "Allow auto-merge" setting, which
  `scripts/setup-branch-protection.sh` turns on.)

- **Release candidate:** push a `vX.Y.Z-rc.N` tag, normally off the feature branch
  before you merge it. It runs the full suite and publishes a single immutable
  `:X.Y.Z-rc.N` image + a GitHub pre-release. An RC never moves `:latest`/`:X.Y`,
  and its version comes from the tag, not `package.json`.

- **No rolling pre-release image.** The old `:develop` tag is gone; only releases
  and RCs are published.

### Optional: local release-bump reminder

Run `make hooks` once to opt in to the repo's git hooks
(`git config core.hooksPath scripts/hooks`). The advisory `pre-push` hook warns —
without ever blocking the push — when you push a branch at a version that's already
been released, so you remember to bump before opening the PR. CI's release guard
stays the real gate. Disable with `git config --unset core.hooksPath`.

Operator upgrade/rollback guidance lives in [`docs/UPGRADING.md`](docs/UPGRADING.md).

## Branch protection

The exact protected-branch ruleset is applied (and re-applied) with
[`scripts/setup-branch-protection.sh`](scripts/setup-branch-protection.sh). See that
script's header for what it enforces and the one prerequisite (an authenticated
`gh`). Note: GitHub requires a paid plan for branch protection on **private** repos;
it is free once a repo is public.
