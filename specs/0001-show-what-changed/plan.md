# Implementation Plan: Show what changed in the update toast (release-note delta)

**Spec**: [`spec.md`](spec.md) · **Branch**: `feat/0001-show-what-changed` · **Status**: planned

## Approach

Carry a small, build-stamped changelog through the same path `VERSION` already travels (Docker
build-arg → client define + server ldflags → `/v1/config`), then compute a **per-user delta** in
the client and render it in the existing update toast. All the interesting logic (delta, cap,
prettify) is pure and unit-tested; the build/CI parts are thin glue.

### 1. Notes source — `scripts/release-notes.sh` (new, pure git)

Emits a JSON array `[{ "sha": "<12-char>", "subject": "<raw conventional-commit subject>" }]`,
newest-first, for commits since the last release tag:

- Base = highest existing `vX.Y.Z` tag (or repo root if none).
- `git log <base>..HEAD --no-merges --format='%h%x1f%s'` → JSON (merge commits already excluded;
  raw subject kept — prettification is a tested client concern, not bash's).
- No dependencies; safe when there are zero commits (emits `[]`).
- Reused by `release.yml`'s existing "Compose release notes" step too (DRY), and called by CI to
  produce the build-arg.

### 2. Build plumbing (mirror VERSION)

- **CI** (`ci.yml` `develop-image`, `release.yml`): `NOTES=$(scripts/release-notes.sh)`, pass
  `--build-arg RELEASE_NOTES="$NOTES"`.
- **Dockerfile**: `ARG RELEASE_NOTES='[]'`.
  - Client stage: `RING_RELEASE_NOTES="$RELEASE_NOTES" npm run build`.
  - Server stage: `-ldflags "... -X main.releaseNotesB64=$(printf %s "$RELEASE_NOTES" | base64 -w0)"`
    — **base64** sidesteps all quoting/space problems of stuffing JSON into ldflags, and keeps the
    stateless single-binary model (no extra file to ship).
- **vite.config.ts**: `__RELEASE_NOTES__` define = parsed `process.env.RING_RELEASE_NOTES` (default
  `[]`). Add the type to `src/env.d.ts`/globals next to `__APP_VERSION__`.

### 3. Server

- `main.go`: `var releaseNotesB64 = ""`; at boot decode base64 → JSON → `[]ReleaseNote` (empty on
  any error). Plumb to `Handlers.ReleaseNotes`.
- `config_handler.go`: add `"notes": h.ReleaseNotes` to the `/v1/config` map (empty array when none).

### 4. Client

- **`src/services/release-notes.ts`** (new, pure): `type ReleaseNote = { sha: string; subject: string }`;
  - `computeDelta(incoming, running): ReleaseNote[]` — incoming entries whose `sha` ∉ running.
  - `prettify(subject): string` — strip `^type(scope)?!?:\s*` and upper-case the first letter.
- **`src/components/WhatsNewSheet.vue`** (new): an `IonModal` sheet that lists the delta (prettified,
  newest-first, scrollable) and offers an Update action. Reusable; Ionic-native, no inline colors.
- **`api.ts`**: `fetchServerConfig` return type gains `notes?: ReleaseNote[]`.
- **`useAppUpdate.ts`**: on `needRefresh`, fetch `/v1/config` → `incoming = notes ?? []`;
  `running = __RELEASE_NOTES__`; `delta = computeDelta(incoming, running)`. If `running` is empty
  (old client) or `delta` is empty → today's generic toast (unchanged). Else show a toast whose
  message names the version and which carries a **"What's new (N)"** button that presents
  `WhatsNewSheet` with the delta; Update/Later and skip-waiting are unchanged.

## Research / decisions (clarify)

- **Delta by SHA**, not range math — exact even when the "since last tag" base shifts at a release.
- **Prettify in the client**, not in bash — keeps it pure/tested; the build carries raw subjects.
- **base64 ldflags** for the server — robust JSON transport into the binary; no runtime file/env.
- **Toast stays a toast** (plain multiline text) for v1; a richer "what's new" sheet is a future spec.

## Data model / contracts

No DB, migration, or `DB_VERSION` change. `/v1/config` gains an additive optional `notes` field
(older clients ignore it). Wire/zero-knowledge boundary unchanged (public metadata).

## Test strategy (TDD — tests precede implementation)

- `src/services/release-notes.test.ts`: `computeDelta` (subset/superset/disjoint/empty/`running`-
  empty); `prettify` (type/scope/`!` prefixes, capitalization, non-conforming subject passthrough);
  `capNotes` (under/at/over the cap, `more` count).
- `server/internal/api/config_handler_test.go`: `/v1/config` includes `notes` when set, empty when
  not; base64 decode helper handles valid/empty/garbage.
- Add `src/services/release-notes.ts` to the gated client coverage set (≥ 90%).
- Manual: run `scripts/release-notes.sh` locally and confirm JSON shape; confirm `/v1/config`
  surfaces notes on a built image.
