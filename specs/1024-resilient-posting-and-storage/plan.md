# Implementation Plan: Resilient posting & on-device storage management

**Branch**: `feat/1024-resilient-posting-and-storage` | **Date**: 2026-06-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1024-resilient-posting-and-storage/spec.md`

## Summary

Make sharing media (Wall posts + chat media) **fire-and-forget and crash-safe**. On Share we
persist a pending record — *with our own copies of the selected blobs* — to a new IndexedDB
**outbox**, dismiss the composer instantly, and render the pending item (with progress) on the Wall
feed / in the chat thread. A client-side **upload worker** drains the outbox: encode/resize → upload
each blob → seal + send the envelope, tracking **per-item confirmation** so a resume re-sends only
what the server doesn't already have. The post is "made" (and its disappear timer starts) **only
when the envelope is confirmed**. Interrupted work **auto-retries once** on next app open, then
offers Retry/Cancel. A **storage-estimate guard** at media selection warns before encoding when free
space is short. No new server surface: the existing `uploadBlob` + `createPost` responses ARE the
confirmation; only the *client* changes (plus a `DB_VERSION` bump for the outbox store).

## Technical Context

**Language/Version**: TypeScript (ES modules, `@/`→`src/`), Vue 3 `<script setup>` + Ionic; Go 1.26 server (unchanged by this feature).

**Primary Dependencies**: Vue 3 / Ionic, the `idb` wrapper (`src/db/idb.ts`) + change-bus + `useLiveQuery`, the existing media pipeline (`media-transfer` upload/download, `media-video` encode, `posts` seal), libsodium core (reused, unchanged).

**Storage**: IndexedDB on-device. **New `outbox` object store** (pending posts + cached working blobs) → `DB_VERSION` bump + `onupgradeneeded` extension. Reuses existing `posts`/`media` stores. Server: PostgreSQL `post_envelopes`/blobs — **no schema change** (FR confirmation rides existing endpoints).

**Testing**: `npm run build` (vue-tsc typecheck) · vitest (client unit, e.g. outbox queries + storage estimate) · Playwright e2e (resilient-posting + resume + storage-guard) · `go test ./...` (server — expected no-op here).

**Target Platform**: Installable PWA (iOS/Android/desktop browsers), offline-first.

**Project Type**: Web app (PWA client + Go backend); **this feature is client-only**.

**Performance Goals**: Composer dismiss + pending item visible **< ~300 ms** (SC-001); progress updates feel live; the worker reuses the pipeline's existing off-main-thread encode so it doesn't freeze the UI.

**Constraints**: Zero-knowledge boundary intact; offline-first (IndexedDB is source of truth); PIN-lock at-rest model unchanged; forward-only schema (DB version bump, no edits to shipped upgrades); Ionic-first UI.

**Scale/Scope**: Small per-user outbox (typically 0–3 pending posts; ≤10 media items each per the existing cap). Cached working blobs are transient (deleted on finalize/cancel).

## Constitution Check

*GATE: must pass before Phase 0; re-checked after Phase 1.*

- **I. Zero-Knowledge Boundary (NON-NEGOTIABLE)** — PASS. Nothing new crosses to the server: only sealed ciphertext + opaque blob ids are uploaded, exactly as today. The outbox's cached working blobs are **local-only plaintext**, the same class as the existing `media` store blobs (device + PIN-lock protected, not separately AEAD-wrapped) — no regression. A dedicated **"Zero-Knowledge Impact"** section is added to the spec (Principle I requires it). **`/speckit-checklist` is REQUIRED** (touches Principle I) and runs before `/speckit-implement`.
- **III. Test-Driven Development** — PLANNED. `tasks.md` will order failing tests first: vitest unit tests for outbox queries + per-item confirmation + the storage estimate; an e2e spec for share→dismiss→pending→finalize, kill→auto-retry→Retry/Cancel, and the storage-guard warning. New store/data-layer logic ships unit tests; new user-facing behavior extends `e2e/`.
- **IV. Crypto Discipline** — PASS. No new crypto; reuses the existing seal/upload path. At-rest model unchanged (cached blobs follow the existing `media`-store treatment, not "secrets").
- **V. Offline-First Data Integrity** — PASS with action. Adding the `outbox` store **MUST bump `DB_VERSION` and extend `onupgradeneeded`** in `src/db/idb.ts`; writes go through the change-bus so `useLiveQuery` keeps the pending UI reactive. Own-data sync semantics unaffected (the outbox is pre-publish local state).
- **VI. Stateless Server & Forward-Only Migrations** — PASS. No server change, no SQL migration (confirmation is the existing `uploadBlob`/`createPost` responses; `createdAt` is set client-side at confirm time).
- **XI. Ionic-First UI** — PASS. Pending card = stock `ion-progress-bar`/`ion-spinner` + `ion-button` (Retry/Cancel); storage warning = `alertController`/`ion-toast`. No bespoke components.
- **VII/VIII** — the feature commit's release-note subject reads as benefit-focused copy; the feature→develop PR lists `Closes #N` for each task issue.

No violations requiring justification → **Complexity Tracking left empty**.

## Project Structure

### Documentation (this feature)

```text
specs/1024-resilient-posting-and-storage/
├── plan.md              # This file
├── research.md          # Phase 0 decisions
├── data-model.md        # Phase 1 — the outbox entity + state machine
├── quickstart.md        # Phase 1 — how to exercise/verify
├── contracts/
│   └── outbox.md        # Phase 1 — client outbox/worker contract (no new server API)
└── tasks.md             # /speckit-tasks output (later)
```

### Source Code (repository root — client-only feature)

```text
src/
├── db/
│   ├── idb.ts                 # DB_VERSION bump + 'outbox' store (onupgradeneeded)
│   ├── types.ts               # OutboxPost type
│   └── queries.ts             # outbox CRUD + per-item confirmation; createPost → enqueue
├── services/
│   ├── outbox.ts              # NEW: the upload worker (drain/resume/auto-retry once)
│   ├── storage-estimate.ts    # NEW: navigator.storage.estimate() guard (+ headroom factor)
│   └── (media-transfer.ts, posts.ts, media-video.ts reused unchanged in shape)
├── composables/
│   ├── useWall.ts             # merge outbox (pending) items into the feed at the top
│   └── useOutbox.ts           # NEW: reactive pending list + progress (useLiveQuery on 'outbox')
└── views/
    ├── detail/PostComposerPage.vue   # Share → enqueue + dismiss immediately
    ├── tabs/WallPage.vue             # render pending posts (progress, Retry/Cancel)
    └── detail/ChatDetailPage.vue     # render pending chat media message + storage guard

e2e/
└── resilient-posting.spec.ts  # NEW: dismiss/pending/finalize, resume+auto-retry, storage guard
```

**Structure Decision**: Single client codebase (the repo's `src/`); no `backend/frontend` split is
needed because the server is untouched. The outbox + worker live in `src/db` + `src/services` (the
established data/non-UI layers); UI is confined to the composer, Wall, and chat detail views.

## Complexity Tracking

> No constitution violations — section intentionally empty.
