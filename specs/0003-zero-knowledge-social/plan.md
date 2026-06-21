# Implementation Plan: Zero-Knowledge Social Wall

**Branch**: `feat/0003-zero-knowledge-social` | **Date**: 2026-06-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/0003-zero-knowledge-social/spec.md`

## Summary

Add a **Wall**: end-to-end-encrypted status posts (text / voice / video / image) shared to a chosen
audience of **all friends** or an author-private **close-friends** subset, with author-chosen
lifetime, plus audience-visible **reactions** and **comments** and an author-only **view list**.

The key technical insight from the codebase audit: **friendship already exists**. The `connections`
subsystem (server `0017_connections.sql` + `connections_handlers.go` + `store/connections.go`; client
`src/services/connections.ts`, the `requests` IndexedDB store, and the Contacts-page request UI) is a
complete request→accept/decline/withdraw handshake with E2EE-gating and block interplay. **User Story
1 is therefore mostly satisfied today** — this feature *reuses* it (treating an accepted connection as
a "friend") and adds only a small **close-friends** tier on top.

The genuinely new surface is **posts + engagement**, built to preserve zero-knowledge by reusing
existing crypto primitives:

- A post is encrypted once under a fresh **per-post content key**; that key is wrapped per audience
  member over their existing 1:1 Double Ratchet session (the same per-recipient key-distribution
  pattern `senderkeys.ts` already uses). Media reuses the existing per-file AES-GCM blob transfer,
  with the file key carried *inside* the sealed post payload.
- The server stores only **opaque post ciphertext + per-recipient key envelopes + coarse expiry**,
  and addresses each post to its recipient set — exactly today's message trust model.
- **Engagement (reactions/comments)** is encrypted under the *same post content key* (which every
  audience member already holds) and submitted to the relay, which **fans it out to the post's stored
  audience**. The engager never learns the roster (the server addresses it), only audience members
  can produce valid ciphertext, and delivery does not depend on the author being online. **View
  receipts** are 1:1 viewer→author signals gated by the existing seen-receipts setting.

Lifetime/expiry reuses the existing disappearing-message TTL + sweep. Settings reuse the declarative
`schema.ts` (re-introducing *real*, wired post/Wall controls where dead "Status" placeholders were
removed in a separate cleanup).

## Technical Context

**Language/Version**: TypeScript (ES modules, Vue 3 `<script setup>` + Ionic) on the client; Go 1.26
(stdlib `net/http`) on the server.

**Primary Dependencies**: client — libsodium-wrappers-sumo (existing crypto core: X3DH, Double
Ratchet, sender keys), Ionic/Vue, IndexedDB via `src/db/idb.ts`; server — `pgx` v5, embedded SQL
migrations, existing WS hub + push.

**Storage**: client IndexedDB (source of truth, bump `DB_VERSION` 8 → 9, add `posts` +
`postEngagement` stores; extend `contacts` with a close-friend flag). Server PostgreSQL (new
forward-only migration `0021_posts.sql`).

**Testing**: client — vitest unit tests for the pure crypto/post helpers + Playwright e2e under
`e2e/`; server — `go test ./...` against the in-memory fake store (one `_test.go` per handler/store).

**Target Platform**: installable PWA (mobile + desktop) + the single `ringd` container.

**Project Type**: web (Vue PWA client + Go server in one repo, one image).

**Performance Goals**: Wall feed renders incrementally and stays reactive via `useLiveQuery`; posting
and engagement feel instant locally (offline-first) and converge on next sync. No new polling.

**Constraints**: NON-NEGOTIABLE zero-knowledge (Principle I) — server never sees post/media/reaction/
comment plaintext, media keys, view-list, or close-friends membership. Offline-first (Principle V).
Reuse existing crypto only (Principle IV). Ionic-first UI (Principle XI). Single image + WS `?token=`
auth (Domain Constraints).

**Scale/Scope**: single Ring network instance; audiences bounded by a user's friend count (tens to
low hundreds); per-post fan-out is N envelopes like a group message today.

## Constitution Check

*GATE: must pass before Phase 0 and re-checked after Phase 1.*

| Principle | Gate | Status |
|---|---|---|
| I. Zero-Knowledge (NON-NEGOTIABLE) | No server plaintext; spec has Zero-Knowledge Impact; metadata minimized | **PASS (by design)** — posts/engagement are ciphertext + per-recipient envelopes; server learns only author, recipient set (as today), coarse size/expiry, and that engagement occurred. Close-friends membership and view-list never leave the device readable. A dedicated crypto/ZK checklist is REQUIRED (Principle IV + Gate sequencing) and is produced via `/speckit-checklist`. |
| II. Spec-Driven | specify→clarify→plan→tasks→analyze→issues→implement | **ON TRACK** — specify ✓, clarify ✓, plan (this), tasks next. |
| III. TDD | failing tests before impl; crypto/store/handler unit tests; e2e for behavior | **PLANNED** — tasks.md will order red→green; new crypto (post seal/open, engagement) gets forgery/replay/out-of-order/skipped-key tests; new handlers get fake-store tests; new user flows get an `e2e/` spec. |
| IV. Crypto Discipline | reuse libsodium core; pure functions; `messaging.ts` crypto-only; AEAD-at-rest | **PASS** — reuse per-recipient key wrapping (à la `senderkeys.ts`) + per-file AEAD blobs; new pure helpers (`crypto/post.ts`) testable without IndexedDB; no new primitives/schemes. Checklist required. |
| V. Offline-First | IndexedDB source of truth; bump `DB_VERSION`; reactive; LWW own-sync | **PASS** — new `posts`/`postEngagement` stores + `DB_VERSION` 8→9 forward migration; `useLiveQuery`-backed Wall; close-friend flag rides own-data sync (LWW on `updatedAt`). |
| VI. Stateless Server & Forward-Only | new numbered migration; stdlib handlers; small interfaces; fake-store tests | **PASS** — add `0021_posts.sql`; new `PostStore` interface at the call site; no `SECRETS_KEY` impact. |
| VII. Quality Gates | typecheck+build, go build/vet/test, vitest+floors, e2e | **PLANNED** — part of Definition of Done. |
| VIII. Traceable Delivery | issues per task; `Closes #N`; ROADMAP generated | **ON TRACK** — `taskstoissues` step; ROADMAP row `0003` already generated. |
| IX. Privacy & Data Minimization | minimum metadata; AGPL | **PASS** — server stores no new identity-revealing plaintext; engagement metadata is the minimum to route (submitter + post id). |
| X. a11y / i18n | Ionic schema settings; bidi text | **PASS** — post text surfaces reuse the bidi-aware composer approach; Wall built from Ionic. |
| XI. Ionic-First UI | stock Ionic + `--ring-*` tokens; settings = schema edit | **PASS** — Wall/feed, composer, request/engagement UIs compose `ion-*`; post/Wall settings are a `schema.ts` data edit. Any bespoke media-post tile is composed from Ionic + existing media components and reasoned in research.md. |

**Result: PASS.** No principle requires a waiver. One mandatory follow-up: the crypto/ZK **checklist**
(Principle I & IV) before `/speckit-implement`.

## Project Structure

### Documentation (this feature)

```text
specs/0003-zero-knowledge-social/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions & rationale
├── data-model.md        # Phase 1 — entities (client + server)
├── quickstart.md        # Phase 1 — how to exercise the feature
├── contracts/
│   └── http-api.md      # Phase 1 — new HTTP/WS contracts
├── checklists/
│   └── requirements.md  # spec-quality checklist (done) + crypto/ZK checklist (via /speckit-checklist)
└── tasks.md             # Phase 2 — /speckit-tasks (NOT created here)
```

### Source Code (repository root)

```text
src/                                  # Vue PWA client
├── services/
│   ├── crypto/
│   │   ├── post.ts                   # NEW: pure post seal/open + engagement seal/open (per-post key wrap)
│   │   └── senderkeys.ts             # REUSE: per-recipient key-distribution pattern
│   ├── posts.ts                      # NEW: post orchestration (crypto-only, like messaging.ts; no store writes)
│   ├── media-transfer.ts             # REUSE: per-file AEAD blob up/download
│   ├── connections.ts                # REUSE/EXTEND: friendship (already request/accept/withdraw)
│   └── directory.ts                  # REUSE: public profile (avatar/name/username) on posts
├── db/
│   ├── idb.ts                        # EDIT: DB_VERSION 8→9; add 'posts','postEngagement' stores; close-friend
│   ├── types.ts                      # EDIT: Post, PostEngagement, ViewReceipt; Contact.closeFriend
│   └── queries.ts                    # EDIT: post/engagement orchestration (queries.ts → posts.ts, one-way)
├── composables/
│   └── useWall.ts                    # NEW: reactive Wall feed + per-post engagement (useLiveQuery)
├── views/
│   ├── tabs/WallPage.vue             # NEW: the Wall feed tab (or surfaced where the team prefers)
│   └── detail/
│       ├── PostComposerPage.vue      # NEW: compose text/voice/video/image + audience + lifetime
│       ├── PostDetailPage.vue        # NEW: full-screen post + reactions + comments + (author) views
│       └── CloseFriendsPage.vue      # NEW: curate the close-friends list
├── components/                       # NEW post tiles/reaction bar/comment list — composed from ion-*
├── settings/schema.ts               # EDIT: real post/Wall settings (default audience, post notifications)
└── sw.ts / services/notify*         # EDIT: post/engagement notifications via existing model

server/                               # ringd
├── internal/db/migrations/0021_posts.sql   # NEW: posts, post_envelopes, post_engagement, post_views
├── internal/store/posts.go                 # NEW: PostStore impl (+ posts_test via fake store)
├── internal/api/posts_handlers.go          # NEW: create/list/delete posts; submit/list engagement; views
├── internal/api/router.go                  # EDIT: PostStore interface + routes
└── internal/api/connections_handlers.go    # REUSE: friendship handshake unchanged

e2e/                                  # NEW Playwright spec: friend→post→view→react→comment→expire
```

**Structure Decision**: single repo / single image (web). The feature is additive: new client
services/stores/views + one server migration/store/handler set, all following existing conventions
(`queries.ts → {posts.ts, messaging.ts}` one-directional; stdlib handlers on small interfaces; embedded
forward-only migration). Friendship is **reuse**, not new.

## Phasing (delivery order, mirrors spec priorities)

1. **P1 — Friendship reuse + close-friends tier**: confirm/connect the existing connections flow as
   "friends"; add `Contact.closeFriend` + `CloseFriendsPage`. (Small; unblocks audiences.)
2. **P1 — Posts MVP**: `crypto/post.ts` + `posts.ts` + `posts` store + `0021_posts.sql` +
   `posts_handlers` (create/list/delete) + composer + Wall feed (text first, then media reuse) +
   lifetime/expiry via existing sweep.
3. **P2 — Reactions (audience-visible)** + **close-friends audience** end-to-end.
4. **P3 — Comments thread** + **view receipts** (seen-receipts-gated) + post/engagement notifications
   + settings.

Each slice is independently testable (spec's Independent Test per story).

## Complexity Tracking

No constitution violations requiring a waiver. Notable complexity, justified:

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Per-post content key wrapped per recipient (vs. a ratcheting sender key per author) | Posts are independent items with per-post audiences and per-post lifetime; a fresh per-post key gives clean per-post access control + revocation-by-expiry | A long-lived author sender key would entangle all posts under one key and complicate per-post audience/expiry and close-friends scoping |
| Server fan-out of engagement to the post's stored audience | Keeps the close-friends roster author-private while letting any audience member engage and not depend on the author being online | Author-relay re-broadcast adds an author-online dependency; direct viewer→audience addressing would leak the roster to the engager |
| New `postEngagement` store + `post_engagement` table | Reactions/comments/views have different lifecycle + query patterns than messages | Overloading the `messages`/`requests` stores would blur the chat vs. wall domains and complicate sweeps |
