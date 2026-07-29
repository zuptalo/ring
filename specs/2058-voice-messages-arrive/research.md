# Phase 0 Research: Voice messages never arrive as an empty bubble (spec 2058)

All findings verified against the tree on `fix/2058-voice-messages-arrive` at 2026-07-29.

## R1 — Where the blank actually comes from

**Finding**: `ChatDetailPage.vue:306` opens a `<template v-else-if="m.mediaId && mediaInfo[m.mediaId]">`
that contains the round note, `<voice-player>` (316), `<audio-card>` (328) and the file chip (343).
The two pending fallbacks that follow are a mutually-exclusive `v-if` / `v-else-if` pair:

- `356-378`: `((m.kind === 'video' && !m.videoNote) || m.kind === 'image') && !m.mediaId && m.pendingMedia`
- `379-394`: `(m.kind === 'audio' || m.kind === 'file') && !m.mediaId && m.pendingMedia`

`kind === 'voice'` matches neither, and a round note is explicitly excluded by `!m.videoNote`. With
no branch taken, the bubble body is empty.

**Decision**: fix in the template chain, not in the data layer — the message row is already correct
in IndexedDB, so this is purely a missing render branch plus a recovery trigger.

## R2 — Placeholder shape: chip vs. voice-shaped

**Decision**: a **voice-shaped** placeholder that matches `VoicePlayer`'s row metrics, not the
generic `.pending-chip`.

**Rationale**: `VoicePlayer` renders a ~34-38px flex row (`.vp`, CSS 160-171: play disc 34x34 +
`.vp-wave` 24px + `.vp-time` + speed pill). A `.pending-chip` is a different height, so the bubble
would visibly resize the moment the fetch lands. Spec 1011 already paid for that lesson on images —
gating a frame on `mediaInfo` inserted ~0-height rows that expanded later and broke the scroll
anchor (comment at `ChatDetailPage.vue:250-256`). A same-height placeholder means the resolve is a
swap, not a reflow.

**Alternatives considered**:
- *Reuse `.pending-chip` verbatim* — cheapest, but reintroduces the reflow the codebase explicitly
  designs against, and reads as a file rather than a voice message.
- *Render `VoicePlayer` itself with a null src* — rejected: it owns playback state and registers
  with the global single-source player (`useAudioPlayer`); driving it with no audio invites a
  half-live player in the global registry.

**Constitution XI note**: this is hand-rolled markup rather than a stock Ionic component. Justified:
there is no Ionic primitive for a voice bubble; its sibling `VoicePlayer` is itself hand-rolled
(Ionic only for `ion-icon`); and the placeholder is composed from the **existing** `.dl-ring` /
`.dl-btn` download vocabulary and existing theme tokens rather than inventing new ones.

## R3 — Where to persist the failed state

**Decision**: **one** new optional field on `Message` — `dlFailedAt?: number`. The auto-retry counter
is **not** persisted; it lives in a module-scoped in-memory `Map`, capped at 3 attempts per message
per session.

> **Revised after analysis.** This decision originally added a second persisted field,
> `dlAttempts?`. That was wrong: a persisted counter means a message that burns its three attempts
> during one offline session becomes permanently manual-only, which directly contradicts FR-013 /
> SC-004 ("messages stranded before this fix recover on the next open, with no re-send"). The
> counter's only job is to stop a tight loop *within* a session, which a session-scoped map does
> exactly — and it resets for free on restart, which is precisely the FR-013 behavior.

**Rationale**: FR-008 requires the failed state to survive the recipient navigating away and coming
back, which a component-local reactive map cannot do (leaving the chat unmounts the page). The
`Message` row is already the home for the parallel send-side concept (`failReason?: 'too-large' |
'cant-convert'`, `types.ts:340`, and `jobAttempts?`, `:336`), so this mirrors an established shape
rather than inventing one.

**DB_VERSION**: **no bump needed.** Constitution V requires a bump when *adding or altering an
object store*; IndexedDB records are schemaless, and this is one optional field on an existing
`messages` record. Existing optional fields (`failReason`, `mediaCleared`, `posterData`) were added
the same way. Old rows simply read `undefined`, which is exactly "never failed".

**Alternatives considered**:
- *Reactive map in the page* — rejected, does not survive unmount (fails FR-008's "later").
- *Reuse `status: 'failed'`* — rejected: `MessageStatus` (`types.ts:262`) is the **send** lifecycle
  and an incoming message is `'delivered'`/`'seen'`. Overloading it would corrupt receipt logic.

## R4 — On-view recovery trigger

**Decision**: reuse the existing per-bubble `IntersectionObserver` (`ChatDetailPage.vue:3284`,
spec 1013's read-receipt observer) as the trigger, adding a **separate debounced handler** beside
`markVisibleSeen()` rather than entangling the two.

**Rationale**: the observer already observes exactly the right nodes — every bubble carries
`:data-mid="m.id"` (template 213) and re-observation on window slide is already handled
(watcher 4011-4015). Its callback is deliberately "just a cheap TRIGGER" (comment 3281-3283) that
discards entry data and re-runs an authoritative geometry scan, so hanging a second consumer off it
is the intended extension point. Keeping the handlers separate protects the read-receipt path,
which is delicate (`seenSettled` / `seeking` / visibility gates at 3303-3306).

**Alternatives considered**:
- *A third IntersectionObserver* — rejected as redundant; same nodes, same lifecycle, more teardown
  surface.
- *Recover on chat open only* — rejected: fails a long chat where the pending message is far up the
  scrollback, and duplicates what `resumePendingMediaJobs()` already does at app start.

## R5 — Download concurrency

**Finding**: **downloads are completely unbounded today.** Spec 2053's lanes (`queries.ts:2498-2553`,
`heavyLane = createLimiter(1)`, `lightLane = createLimiter(3)`) are entered only by
`scheduleMediaJob()`, which wraps the outgoing compress+seal+upload path. `downloadMessageMedia`
(`queries.ts:2940`) calls `receiveIncomingMedia` directly with no limiter, and
`resumePendingMediaJobs` (`:2982-2986`) fires `void downloadMessageMedia(m.id).catch(() => {})` in
an unbounded loop over every pending message on the device.

**Decision**: add a `downloadLane = createLimiter(3)` in `queries.ts` and route
`downloadMessageMedia` through it. Reuses `createLimiter` from `src/utils/concurrency.ts`, which is
already unit-tested (`src/utils/concurrency.test.ts`).

**Rationale**: SC-005 requires that recovering ten consecutive pending voice messages not stampede.
Adding on-view recovery to an already-unbounded path would make an existing latent problem worse,
so the limiter is a precondition of the feature, not a nice-to-have. `3` matches `lightLane`, the
established figure for non-heavy media work.

## R6 — Honest failure across all kinds (US4) is nearly free

**Finding**: `downloadPendingMedia(id)` (`ChatDetailPage.vue:1441`) is the **single shared tap
handler** for every pending kind, and its `catch` is empty (`:1446-1448`, "leave it pending so the
user can tap again").

**Decision**: mark the failure and raise an `appToast` in that one `catch`, giving US4 across photo,
video, audio and document for the same edit. Auto-recovery calls the underlying query function with
a flag so it fails quietly (FR-009) — only a user-initiated tap talks back.

**Rationale**: this is why the clarification's "extend to all media" answer is cheap: the honest
failure lands at a single choke point that all kinds already funnel through.

## R7 — Test seam (Constitution III: a 2001+ fix MUST start with a failing regression test)

**Finding**: there is **no** e2e coverage asserting a voice bubble renders, and no way to **seed**
the bug's state — `testhook.seedMedia` (`testhook.ts:1143-1166`) always sets `mediaId` and
`outgoing: true`, so it cannot produce a *pending incoming* message.

> **Correction after analysis.** An earlier draft of this note also claimed a test "cannot currently
> distinguish a pending voice message from a downloaded one". That is false —
> `testhook.mediaInfo(messageId)` (`:585-604`) already returns `{ hasMedia, pending }`, and
> quickstart.md relies on it. Only the *seeding* half of the gap is real. Extending the
> `messages()` projection is therefore a convenience, not a blocker.

**Decision**: extend the dev-only test hook with (a) `seedPendingIncoming(chatId, kind, opts?)` that
writes an incoming message carrying `pendingMedia` and no `mediaId`, and (b) `pending` +
`dlFailedAt` on the `messages()` projection.

**The seeded reference must be real.** `receiveIncomingMedia` (`media-transfer.ts:228`) fetches
`ref.blobId` from the relay, so a *fabricated* `MediaRef` can never be fetched — every seeded
message would fail, and the whole success path (US1, FR-005, FR-007) would be unreachable from the
harness. The seeder therefore seals and genuinely uploads a tiny audio blob via
`prepareOutgoingMedia` (`media-transfer.ts:203`) and stores the resulting real ref. Note
`seedMedia` (`testhook.ts:1143-1166`) is **not** the seam to copy — it writes a local `Media` blob
and uploads nothing. An explicit `opts.broken` produces the unfetchable ref for the failure cases. Then write the red e2e that asserts the voice bubble has visible content.

**Rationale**: the regression test must reproduce *the reported state* (pending incoming voice), and
that state is currently unreachable from a test. The hook is stripped from production builds
(`src/services/testhook.ts`, per CLAUDE.md), so this adds no shipped surface.

**Assertion shape**: the bug is "the bubble body is empty", so the test asserts on rendered content —
the bubble for a pending incoming voice message must contain a non-empty, visible element. A test
that only checked `pending === true` would pass both before and after the fix and prove nothing.
