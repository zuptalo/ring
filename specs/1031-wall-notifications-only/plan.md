# Implementation Plan: Wall notifications go to the owner only

**Branch**: `feat/1031-wall-notifications-only` | **Date**: 2026-07-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1031-wall-notifications-only/spec.md`

## Summary

Wall engagement (reactions + comments) must alert **only the post owner** — never the rest of
the audience, never the actor. Today the server web-pushes every audience member for each
comment (the noise), and reactions alert nobody (the gap). The change has three coordinated
parts, all riding metadata the server already holds:

1. **Server**: `submitEngagement` stops pushing the whole audience for comments and instead
   pushes a new content-free `{t:'post-activity', post:<id>}` tickle to **the post author
   only**, for reactions *and* comments (never tombstones, never the actor themselves). The
   live WS `post-engagement` nudge to all audience members is unchanged — that is data sync,
   not alerting.
2. **Live page**: the `post-engagement` WS handler, after syncing, surfaces an in-app banner
   iff the engaged post is **our own** (`post.outgoing`), the actor isn't us, the item is
   fresh and not a removal/tombstone, and the new "Activity on your posts" setting is on.
   The decision lives in a pure, vitest-covered predicate.
3. **Service worker** (app closed): a `post-activity` push, when no window client exists,
   fetches that post's engagement, names the actor from server metadata ("〈name〉 commented on
   your post"), and — for reactions — opens the sealed payload locally to drop removals.
   Undecryptable reactions are skipped (never a spurious alert); comments need no decryption
   (`kind` is cleartext).

A new `notifications.wall.activity` toggle (default on) gates all of it, alongside the
existing `notifications.wall.show` (new posts), per clarification. Per-person Wall mute/hide
stays posts-only and does NOT gate engagement alerts (per clarification).

## Technical Context

**Language/Version**: TypeScript 5 (Vue 3 + Ionic 8 PWA, Vite), Go 1.26 (server)

**Primary Dependencies**: libsodium-wrappers-sumo (sealed engagement, already used),
stdlib `net/http` + pgx v5 (server), Web Push/VAPID (existing `internal/push`)

**Storage**: IndexedDB on device (posts / postEngagement / settings stores — no schema
change, so no `DB_VERSION` bump); PostgreSQL server-side (no migration — `PostAuthor` and
`PostAudience` already exist)

**Testing**: vitest (client unit; pure predicate + sw-inbox preview tests), `go test ./...`
(fake-store handler tests), Playwright e2e (multi-account banner assertions)

**Target Platform**: installable PWA (browser + iOS/Android home-screen), single-container
`ringd`

**Project Type**: web app — Vue client at repo root + Go server in `server/`

**Performance Goals**: alert within the existing live-frame path (≪1 s online); one push per
engagement to exactly one recipient instead of N

**Constraints**: zero-knowledge boundary (Principle I) — server routes on metadata it already
has (post id, author, actor, unsealed kind); reaction add-vs-remove is sealed, so that
decision is client-side only. No silent regressions of live engagement sync for the audience.

**Scale/Scope**: ~6 client files + 2 server files + 1 settings key; no data migrations;
3 user stories, 11 FRs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Zero-knowledge boundary | ✅ | Spec carries a Zero-Knowledge Impact section. No new plaintext crosses the wire; push fan-out narrows (metadata reduction). The `post` id in the push payload is inside the encrypted Web Push envelope and is already server-held routing metadata. Reaction add/remove stays sealed; judged on-device. |
| II. Spec-driven | ✅ | Spec 1031, ad-hoc band; this plan + tasks follow the pipeline; analyze precedes implement. |
| III. TDD | ✅ | Failing tests first: Go handler tests (fan-out narrowing), vitest for the pure alert predicate + SW preview, e2e for the banner behavior. Tasks will order Red → Green. |
| IV. Crypto discipline | ✅ | Reuses `sealPostEngagement`/`openPostEngagement` (existing K_post AEAD path); no new primitives, no new key flows. `/speckit-checklist` will run (required — Principle I is touched). |
| V. Offline-first integrity | ✅ | No object-store change → no `DB_VERSION` bump. Engagement sync path untouched for the audience. |
| VI. Stateless server / migrations | ✅ | No schema change; handler + push change only, tested against the fake store. |
| VII. Quality gates | ✅ | `npm run build`, vitest + floors, `go build/vet/test`, e2e where behavior changed. Commit subject is release-note copy. |
| VIII. Traceable delivery | ✅ | tasks → issues → `Closes #N` in the feature→develop PR. |
| IX. Privacy & minimization | ✅ | Strictly less notification metadata leaves the server (1 recipient instead of N). |
| X/XI. A11y / Ionic-first | ✅ | New settings row is a data edit in `schema.ts` (stock `ion-toggle`); banners reuse the existing NotificationBanners surface. |

**Post-design re-check (Phase 1)**: ✅ unchanged — design introduces no new server
capability beyond routing to an already-known author id, no bespoke UI, no new crypto.

## Project Structure

### Documentation (this feature)

```text
specs/1031-wall-notifications-only/
├── spec.md              # Feature spec (+ Zero-Knowledge Impact, Clarifications)
├── plan.md              # This file
├── research.md          # Phase 0: decisions + alternatives
├── data-model.md        # Phase 1: entities/flags touched
├── quickstart.md        # Phase 1: how to run/verify this feature
├── contracts/
│   └── push-and-handlers.md  # Server behavior contract (push targets, WS frames, payloads)
├── checklists/
│   └── requirements.md  # Spec quality checklist (done)
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
server/
├── internal/api/
│   ├── posts_handlers.go        # submitEngagement: push → author only, reactions too
│   ├── posts_handlers_test.go   # fan-out tests (fake store + recording notifier)
│   └── router.go                # PostsStore iface (PostAuthor already present) — likely no change
└── internal/push/
    ├── push.go                  # NotifyPostActivity + postActivityParams ({t:'post-activity',post})
    └── push_test.go             # payload shape test (if params are exported/testable)

src/
├── services/
│   ├── wall-activity-policy.ts       # NEW: pure alert predicate (dependency-free)
│   ├── wall-activity-policy.test.ts  # NEW: vitest (TDD anchor for FR-002/003/004/007/011)
│   ├── sw-inbox.ts                   # previewPostActivity(): fetch + name actor + drop removals
│   ├── sw-inbox.postactivity.test.ts # NEW: vitest for the SW preview (mirrors sw-inbox.preview.test.ts)
│   └── ownsync-keys.ts               # + 'notifications.wall.activity'
├── sw.ts                             # pushKind 'post-activity' + closed-app branch
├── composables/useSync.ts            # post-engagement frame → notifyPostActivity(...)
├── db/queries.ts                     # syncEngagement returns fresh items; notifyPostActivity()
└── settings/schema.ts                # Wall group: 'Activity on your posts' toggle + footer copy

e2e/
└── wall-activity-notify.spec.ts      # NEW: A/B/C accounts — owner-only banners, self-silence, toggle
```

**Structure Decision**: existing monorepo layout; no new directories beyond the one pure
policy module + tests, mirroring the established `notify-policy.ts` pattern.

## Design detail

### Server: `submitEngagement` fan-out (posts_handlers.go)

Current (lines 303–328): WS `post-engagement` to all audience except actor; `NotifyPost`
web push to the same set but only when `kind == "comment"`.

New behavior:

- WS nudge: **unchanged** (all audience except actor — live reconciliation must keep
  working for everyone; suppression is an *alerting* decision, made on the device).
- Web push: for `kind ∈ {reaction, comment}` (NOT tombstone), resolve
  `author := h.Posts.PostAuthor(ctx, postID)`; if `author != uid` (actor), send
  `h.Notifier.NotifyPostActivity(ctx, author, postID)`. Nobody else is pushed. The
  author is part of `PostAudience`, so they keep receiving the WS nudge as today.
- `NotifyPostActivity` (push.go): same transport knobs as the post tickle (long-ish TTL,
  collapsible **per post** — topic derived from the post id so a burst of reactions on one
  post collapses at the push service), payload `{"t":"post-activity","post":"<id>"}`.
  Web Push payloads are encrypted per-subscription (aes128gcm), so the push service never
  sees even this. Topic values must be URL-safe/short — use a hash/prefix of the post id if
  needed (push services cap topic length at 32 chars; post ids are 36-char uuids → use a
  base64url SHA-256 prefix).

Handler tests (fake store + recording fake notifier — extend the existing fakes):

- comment by B on A's post → exactly one activity push, to A; WS nudge still to everyone
  except B.
- reaction by B → same (this is new — today reactions push nobody).
- tombstone → no push at all.
- author engages own post → zero pushes (WS nudge to audience still fires).
- audience member C is never pushed for B's engagement.

### Live page: owner-only in-app banner

- `syncEngagement(postId)` (queries.ts) gains a return value: the list of engagement items
  it newly applied (`{ type, actor, emoji?, at, deleted }`) — already computed in its loop;
  today it returns void, so this is additive and safe for all existing callers.
- New `notifyPostActivity(postId, fresh)` (queries.ts, beside `notifyNewPost`): guards via
  the pure predicate, resolves the actor's contact name/avatar, and calls
  `notifyIncoming({ kind:'system', name, body, url:'/wall/post/<id>', avatar })` with body
  `reacted <emoji> to your post` / `commented on your post`. A session-scoped
  `notifiedEngagementIds` set (mirroring `notifiedPostIds`) dedupes; a 5-minute recency
  guard stops reconnect floods (mirrors `notifyNewPost`).
- `useSync.ts` `post-engagement` branch becomes:
  `const fresh = await syncEngagement(f.post); void notifyPostActivity(f.post, fresh)`.
- **Pure predicate** `src/services/wall-activity-policy.ts` (dependency-free, like
  `notify-policy.ts`): given `{ isOwnPost, actor, self, type, deleted, at, now,
  activityEnabled, tempMuted, alreadyNotified }` → `'alert' | 'skip'`. Rules: own post
  only; actor ≠ self; type reaction (not deleted) or comment (not deleted); fresh
  (≤ 5 min); setting on; not temp-muted; not already notified. Per-user mute/hide is
  deliberately absent (clarified: posts-only). Views and tombstones never alert.
  vitest covers every rule (the TDD anchor for FR-002/003/004/007/011).

### Service worker: closed-app path

- `pushKind()` (sw.ts) learns `'post-activity'` (payload `{t:'post-activity', post}`), and
  the push handler gets a branch mirroring `'post'`:
  - live clients → `postMessage({type:'ring:posts'})` (existing sync nudge) and stop — the
    page owns the alert via the WS frame.
  - no clients → honor `setting('notifications.wall.activity', true)` →
    `previewPostActivity(postId)` → show note(s), `updateAppBadge` untouched (engagement
    doesn't badge; the Wall badge stays post-based).
- `previewPostActivity(postId)` (sw-inbox.ts, beside `previewPosts`):
  1. Read the post row from IDB; require `outgoing === true` (owner check, defense in
     depth) and a `postKey`.
  2. `GET /v1/posts/{id}/engagement` with the session bearer token (existing pattern).
  3. Filter: actor ≠ self; not in the shown-ledger (`sw.wallActShown`, mirroring
     `CONN_SHOWN_KEY` semantics: engagement id + timestamp, capped); `createdAt` within a
     10-minute recency window.
  4. Comments: no decryption needed (`kind` is cleartext) → note "〈name〉 commented on your
     post" (name via `connName`, exactly like `previewPosts`).
  5. Reactions: `openPostEngagement` under the post's `postKey` (libsodium is already
     initialized in the SW for message previews); `remove: true` → skip. Undecryptable
     (locked/cold) → **skip silently** — a possibly-spurious alert is worse than a missed
     reaction; the comment path (the high-signal case) still works undecrypted.
  6. Collapse per post: one fresh item → actor-named note; several → one "New activity on
     your post" note. Tag `ring:post:act:<postId>` (re-notify replaces), url
     `/wall/post/<postId>`.
  7. Mark shown-ledger entries only for what was displayed.
- `showPostNotification` / `previewPosts` (the `'post'` tickle path) is now **new posts
  only** again — its "or engagement" comment updates accordingly.

### Settings

- `schema.ts` Wall group: add
  `{ type:'toggle', title:'Activity on your posts', key:'notifications.wall.activity', default:true }`
  and extend the footer: "Get notified when a friend shares a new post on their Wall, and
  when someone reacts to or comments on your posts." (matches the UI copy voice — no
  em-dashes/semicolons in user-facing copy).
- `ownsync-keys.ts`: add `'notifications.wall.activity'` to `SYNCED_PREF_KEYS` (and the
  ownsync test's expected list if it asserts membership).

### e2e (Playwright, `e2e/wall-activity-notify.spec.ts`)

Three accounts A (owner), B, C (all friends of A; B–C need not be friends — but audience
requires friendship with the AUTHOR only, so B and C both see A's post):

1. A posts; B comments → A shows an in-app banner naming B ("commented on your post");
   C shows no banner; B shows no banner (TC-02, FR-003).
2. B reacts → A banners ("reacted … to your post"); C/B silent (TC-01).
3. A comments on and reacts to A's own post → no banners anywhere (TC-07/08).
4. A toggles `notifications.wall.activity` off (via settings or `__ringTest` setSetting) →
   B comments → no banner for A, but the comment IS visible on A's post detail (FR-005,
   US3-AS4).
5. B removes their reaction → no banner for A.

Follow the existing e2e style (`e2e/wall.spec.ts` helpers, `window.__ringTest`), 2–3
browser contexts, no WebRTC → CI-safe.

## Complexity Tracking

No constitution violations to justify. The one new moving part — the `post-activity` push
type — is required because the existing `post` tickle cannot tell the SW *which* post's
engagement to fetch (and would force the generic-fallback notification for reaction
removals, i.e. a spurious alert). A payload-less alternative was rejected in research.md.
