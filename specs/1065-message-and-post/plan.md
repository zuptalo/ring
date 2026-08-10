# Implementation Plan: Message and Post Audience Insight

**Branch**: `feat/1065-message-and-post` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1065-message-and-post/spec.md`

## Summary

Surface the audience detail Ring already records but hides, through one shared
count-first list, and finish the comment section with replies and comment
reactions.

The shape of the work is lopsided in a useful way. **US1 needs no new storage
and no server change at all** — `Message.receipts` already carries
`deliveredAt`/`seenAt` per member and `MessageInfoPage.vue` throws them away at
the last step. **US2 needs no server change either** — the author-only viewer
endpoint already returns `viewedAt` and is already gated by strict author
equality; the client discards the timestamp and only ever records a view when
the detail page opens. So the two P1 stories are largely a matter of no longer
discarding what we have, plus one new shared component.

The real engineering is in US4/US5, where a reply and a comment reaction need a
parent reference the server must not be able to read. That reference rides
inside the sealed payload, reusing the existing `kind` values so the server sees
byte-identical row shapes, with reaction payloads padded to a constant length so
the extra field cannot be spotted by ciphertext size. The one deliberate
exception is a cleartext `notify` hint on submission, because the server routes
push and can only route to someone it can name (FR-031b).

## Technical Context

**Language/Version**: TypeScript 5 (Vue 3.5 `<script setup>`, Ionic 8.8.8), Go 1.26

**Primary Dependencies**: `@ionic/vue` 8.8.8, `libsodium-wrappers-sumo`, `pgx` v5, stdlib `net/http`

**Storage**: IndexedDB on device (source of truth); PostgreSQL server-side (opaque ciphertext only)

**Testing**: `vue-tsc` typecheck via `npm run build`, vitest units, Playwright e2e under `e2e/`, Go table tests against the in-memory fake store

**Target Platform**: installable PWA, iOS Safari and Chromium; single container serving PWA + API

**Project Type**: monorepo — Vue PWA at the repo root, Go `ringd` under `server/`

**Performance Goals**: first screenful of any audience list under 1 s on a mid-range phone with 300 rows; no increase in feed memory beyond the rendered window

**Constraints**: zero-knowledge boundary is non-negotiable; every service-worker wake must end visibly (iOS revokes a subscription after roughly four silent pushes); offline-first, reconciling on reconnect

**Scale/Scope**: groups have no enforced size cap; posts assumed up to several hundred viewers, reactions, and comments

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1. The table below
is the post-design pass; the pre-Phase-0 pass reached the same verdicts, with
the `notify` exception identified during Phase 0 research and carried here.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Zero-Knowledge Boundary | **PASS with one named exception** | Parent references are sealed; no new `kind`; reaction payloads padded so length does not betray a comment reaction. The `notify` wake hint is cleartext, is the single new field, is named and justified in FR-031b, is audience-validated, capped at 2, and never persisted. Zero-Knowledge Impact section below. Requires `/speckit-checklist` before implement. |
| II. Spec-Driven Development | PASS | specify → clarify → plan done; tasks → analyze → taskstoissues → implement to follow. |
| III. Test-Driven Development | PASS | Pure functions first (seen clamp, parent resolution, padding, paging cursor), each red before green. Server handler changes get sibling `_test.go` cases. New user-facing behaviour gets e2e. |
| IV. Crypto Discipline | PASS | No new primitives. Reuses `sealJson`/`openJson` under the existing per-post key with the existing `posteng` domain separator. The only crypto-adjacent addition is constant-length padding, following the spec 1055 precedent. |
| V. Offline-First Data Integrity | PASS | `parent` is an optional field on an existing object store, so no `DB_VERSION` bump and no `onupgradeneeded` branch. Existing rows read back as top-level. All new views work from local data and reconcile on reconnect. |
| VI. Stateless Server & Forward-Only Migrations | PASS | One new numbered migration adding an index. No new column, no volume, no `SECRETS_KEY` involvement. |
| VII. Quality Gates | PASS | Gates listed under "Definition of done" below. |
| VIII. Traceable Delivery | PASS | Issues per task, `Closes #N` on the PR into `develop`. |
| IX. Privacy & Data Minimization | **PASS with the same exception** | The wake hint is the minimum that routes a push: a capped, audience-validated, unpersisted recipient list. The rejected alternative (waking every prior commenter) added zero metadata but woke people the rules do not name; the requester chose precision over blindness with the cost shown. |
| X. Accessibility & i18n | PASS | Names come from contacts and stay bidi-correct; new rows carry labels and use `ion-*` semantics. No new settings screen. |
| XI. Ionic-First UI | PASS | The sheet is a stock `ion-modal` with breakpoints, copying `ChatListsSheet.vue`. Rows are `ion-item`/`ion-label`/`ion-avatar`. Paging is `ion-infinite-scroll`. No bespoke widget. |

### Deviation noted, not a violation

The constitution names `--ring-*` CSS variables; the codebase actually defines
`--app-*` in `src/theme/variables.css`, and the three `--ring-*` references in
the tree are orphans resolving to fallbacks. This plan uses `--app-*`, the real
convention. Worth a constitution erratum separately.

### Zero-Knowledge Impact

*Required by Principle I for every spec.*

**What crosses the wire that did not before**

1. A sealed `parent` field inside comment and reaction payloads.
2. A cleartext `notify` array on the engagement submission request.

**What is encrypted**: comment text, reply text, reaction emoji, and the parent
reference, all sealed under the per-post key `K_post` with the existing
`posteng` domain separator, which every audience member already holds. No new
key material and no new key exchange.

**What metadata the server can unavoidably see**

| item | before | after |
|---|---|---|
| that a row exists, its `post_id`, `actor`, `created_at` | yes | yes, unchanged |
| `kind` (`comment` / `reaction` / `tombstone`) | yes | yes, **no new value** |
| which comment a reply answers | no | **still no** |
| the size of an individual thread | no | **still no** |
| whether a reaction targets a post or a comment | no | **still no** (constant-length padding) |
| tombstone target id | yes, cleartext | yes, unchanged, not reused, and **not** emitted per comment reaction |
| who a reply is addressed to | no | **yes, the new exception** |
| whether a comment is a reply | no | **yes, derived** — see below |
| roughly how much answering a person attracts on a post | no | **yes, derived** — see below |

**Two derived disclosures, stated plainly.** An earlier draft of this table
claimed the server still could not tell a reply from a plain comment. That was
false the moment the wake hint was accepted. A top-level comment names only the
post owner; a reply names someone else. The contents of the hint therefore
distinguish them, and counting replies addressed to a given person on a given
post approximates how much answering that person's comments attract. Sealing the
parent still hides which comment was answered, all content, and the size of any
individual thread. Recorded as FR-031c rather than left as a comfortable
untruth.

**Why the exception is necessary**: push routing is server-side.
`NotifyPostActivity` takes a user id. There is no way to wake a specific person
without naming them. The alternatives were to wake every prior commenter (zero
new metadata, but it wakes people the notification rules do not name, and on iOS
every wake must end in a visible banner, so surplus wakes become surplus
banners) or to send no push at all (perfectly blind, but a reply to you on
someone else's post stays silent until you open the app). The requester chose
precise targeting with the cost shown.

**Why it is bounded**: audience-validated so it cannot wake a stranger, capped
at 2 so it cannot become a broadcast primitive, the actor is stripped so it
cannot be used to probe membership, used only for routing, and never written to
the database.

**What it does not reveal**: which comment was answered, any text, any emoji,
and the size of any individual thread. The server learns a person, not a
conversation.

**Three further requirements came out of the crypto/ZK checklist** and are part
of this design, not afterthoughts:

- The hint must never reach a server log, metric, or error payload. A recipient
  list is exactly the field that ends up in a request log by accident.
- Deleting a comment must not emit a cleartext deletion marker per comment
  reaction. One marker per reaction would publish the reaction-to-comment
  mapping at comment granularity, which is worse than the accepted exception.
  Devices drop those reactions locally by reading the sealed parent (FR-029c).
- Reaction attribution is a client-side presentation rule over data the whole
  audience already holds, not a server-enforced protection. The viewer list is
  the thing the server actually guards. Stated honestly as FR-033a.

## Project Structure

### Documentation (this feature)

```text
specs/1065-message-and-post/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── engagement-and-views.md
├── checklists/
│   ├── requirements.md
│   └── crypto-zk.md     # added by /speckit-checklist, required before implement
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
src/
├── components/
│   ├── AudienceSheet.vue          NEW  stock ion-modal + paged ion-list
│   ├── AudienceRow.vue            NEW  avatar + name + when (+ emoji)
│   ├── ReactionDetails.vue        generalized onto the shared row
│   └── CommentThread.vue          NEW  one-level thread, bounded replies
├── views/
│   ├── detail/
│   │   ├── MessageInfoPage.vue    tiers become tappable, timestamps kept
│   │   └── PostDetailPage.vue     viewer row, attributed reactions, threads
│   └── tabs/
│       └── WallPage.vue           impression observer, author-only seen row
├── directives/
│   └── seen-in-feed.ts            NEW  shared IntersectionObserver, one-shot
├── services/
│   ├── message-status.ts          + clamped seen (pure, FR-034)
│   ├── wall-activity-policy.ts    + "answers my comment" input (pure)
│   ├── sw-inbox.ts                classifier opens comment payloads
│   └── api.ts                     paging params, notify, viewedAt kept
├── db/
│   ├── types.ts                   PostEngagement.parent
│   └── queries.ts                 replies, comment reactions, padding,
│                                  bounded engagement fetch, view reporting
└── utils/
    ├── post-time.ts               single ago(); PostDetailPage's copy removed
    └── engagement-page.ts         NEW  pure paging/assembly helper

server/
├── internal/api/
│   ├── posts_handlers.go          limit/before paging, notify validation+routing
│   └── posts_handlers_test.go     fake-store unit tests per contract rule
├── internal/store/
│   └── posts.go                   keyset ListEngagement
└── internal/db/migrations/
    └── 0030_engagement_paging.sql NEW  (post_id, created_at, id) index

e2e/
├── message-audience.spec.ts       NEW  US1
├── post-audience.spec.ts          NEW  US2 + US3
└── comment-threads.spec.ts        NEW  US4 + US5

drive/scenarios/
├── audience-receipts.mjs          NEW
├── post-views.mjs                 NEW
└── comment-threads.mjs            NEW
```

**Structure Decision**: the existing monorepo layout is used as-is. The only new
structural concepts are one shared component pair (`AudienceSheet` +
`AudienceRow`) that FR-001 requires all four surfaces to use, and one directive
for feed impressions following the existing
`src/directives/autoplay-visible.ts` singleton-observer pattern.

## Implementation sequencing

Ordered so each P1 story is independently shippable, matching the spec's
priorities.

**Phase A — US1 (no server, no storage).** Pure `clampedSeen` in
`message-status.ts`, unit tests first. Then `AudienceRow`/`AudienceSheet`. Then
rewire `MessageInfoPage.vue` tiers to keep timestamps, derive `notDelivered`
from the send-time roster rather than the live one, and mark members who left.
First e2e that renders the page.

**Phase B — US2 (no server).** `listPostViews` keeps `viewedAt`. Author-only
seen row on the post and in the feed, opening the same sheet. Then the
`seen-in-feed` directive with one shared observer, the local already-reported
set, and the dwell rule. e2e plus a direct 403 check.

**Phase C — US3.** Attributed reaction list on the author's own post, reusing
the sheet, grouped by emoji, most-used first.

**Phase D — server paging.** Migration, keyset `ListEngagement`, handler params,
fake-store tests, then the client's bounded fetch and on-demand reach-back.
Lands before Phase E so threads never depend on an unbounded fetch.

**Phase E — US4/US5.** Sealed `parent` with the one-level resolution invariant,
constant-length reaction padding, `notify` validation and routing server-side,
the pure notification predicate change, the SW classifier opening comment
payloads, then `CommentThread.vue` and the comment reaction tally.

## Definition of done

- `npm run build` (vue-tsc typecheck + vite build) passes
- `cd server && go build ./... && go vet ./... && go test ./...` pass
- vitest passes and coverage floors hold (`internal/config` has an 85% floor)
- `npm run test:e2e` passes, including the three new specs
- the quickstart's zero-knowledge check shows uniform reaction payload lengths,
  no new `kind` value, and no `notify` column
- dev-stack verification pass with screenshots for each user story

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Cleartext `notify` hint on engagement submission (Principles I and IX) | The server routes push and cannot read the sealed parent, so it cannot wake the person answered without being told who they are | Waking every prior commenter adds no metadata but wakes people the notification rules do not name, and on iOS every wake must end in a visible banner, so surplus wakes become surplus banners. Sending no push leaves a reply to you on someone else's post silent until you next open the app. The requester chose precise targeting with the cost shown, recorded in the spec's Clarifications and FR-031b. |
