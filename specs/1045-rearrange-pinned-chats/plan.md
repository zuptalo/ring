# Implementation Plan: Rearrange pinned chats with drag, stable manual order, and long-press chat preview

**Branch**: `feat/1045-rearrange-pinned-chats` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/1045-rearrange-pinned-chats/spec.md`

## Summary

Give the pinned-chat grid (spec 1044) a user-owned order: a `pinnedRank` field on
the Chat record (synced like `pinned` via encrypted own-data sync) replaces
recency as the grid's sort key, so message activity never moves a pin. A
pointer-event drag controller on the Chats tab implements iMessage-style
rearrange (lift → drag → drop), drag-out-to-unpin, and drag-row-in-to-pin (with
a forbidden badge at the 9-pin cap). A longer press opens a read-only "peek"
overlay of the chat's latest messages with Pin/Unpin, Mark as Unread/Read, and
Delete beneath it. Client-only; the server is untouched.

## Technical Context

**Language/Version**: TypeScript 5 / Vue 3 `<script setup>` + Ionic 8 (client only)

**Primary Dependencies**: Existing app stack — Ionic components, `useLiveQuery`,
`idb.ts` wrapper, `queries.ts` data layer, `message-preview.ts` helpers. No new
dependencies (drag is hand-rolled on pointer events; no drag library).

**Storage**: IndexedDB `chats` store gains an optional `pinnedRank?: number`
field on existing records — no new object store, **no DB_VERSION bump needed**
(field-level addition; absent = legacy pin). Rides the existing encrypted
own-data sync (whole chat records, LWW on `updatedAt`).

**Testing**: vitest unit tests for the pure pin-order/drag-math helpers
(`src/utils/chat-pins.ts` + new `src/utils/drag-math.ts`); Playwright e2e for
reorder-persists + peek behaviours; `npm run build` typecheck gate.

**Target Platform**: Installable PWA — touch (iOS/Android) and desktop
(mouse) drive the same pointer-event gestures.

**Project Type**: Web app (client half of the monorepo; zero server changes).

**Performance Goals**: Drag tracking at 60 fps (transform-only updates on the
floating element; grid gap animations via CSS transitions; no re-sort or DB I/O
until drop).

**Constraints**: Zero-knowledge boundary untouched (no new wire data —
`pinnedRank` is inside the already-sealed own-data snapshot). The peek overlay
must not mark the chat read. Long-press must not fight scrolling, Ionic swipe
gestures, or the existing tap/contextmenu handlers.

**Scale/Scope**: ≤ 9 pinned chats; peek renders ~15 most-recent messages from
local IndexedDB. Three components touched, one new component, one new
composable, two new pure-helper modules.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Zero-Knowledge Boundary** — PASS. No new server surface. `pinnedRank`
  lives inside chat records that already sync as sealed ciphertext. The peek
  overlay renders local data only. (Zero-Knowledge Impact section added to the
  spec.)
- **II. Spec-Driven Development** — PASS. Spec 1045 (ad-hoc band), this plan,
  tasks to follow; branch `feat/1045-rearrange-pinned-chats`.
- **III. Test-Driven Development** — PASS. Pure helpers get failing-first
  vitest coverage (order comparator, reorder/insert math, hit-testing); e2e
  extends the chats suite for reorder persistence + peek. Tasks order tests
  before implementation.
- **IV. Crypto Discipline** — N/A (no crypto changes; nothing new touches
  `messaging.ts`).
- **V. Offline-First Data Integrity** — PASS. Field-level addition to the
  `chats` store via the `idb` wrapper; no store added → no `DB_VERSION` bump.
  Legacy pins (no rank) keep working; ranks are stamped by a one-time
  normalizer. LWW on `updatedAt` unchanged.
- **VI. Stateless Server** — N/A (server untouched).
- **VII. Quality Gates** — PASS. `npm run build`, vitest, e2e planned; commit
  subjects will be release-note copy.
- **VIII. Traceable Delivery** — `taskstoissues` deferred until after the
  user's local test round (explicit user instruction: nothing leaves the
  machine yet); issues will be created before the PR.
- **X. Accessibility & i18n** — PASS. Tiles/rows keep aria labels; the peek
  gets `role="dialog"` + labelled actions; drag is an enhancement — every
  outcome (reorder aside, which is new) remains reachable via existing
  swipe/sheet surfaces; RTL-safe (logical positions, `dir="auto"` preserved).
- **XI. Ionic-First UI** — PASS with one justified custom piece. The peek
  overlay composes `ion-backdrop`, `ion-list`/`ion-item` (menu), existing
  `UserAvatar`/`EmojiText`; the floating drag avatar and message-bubble
  mini-list are custom because no Ionic primitive provides a drag proxy or an
  iMessage peek card (`ion-reorder-group` only reorders vertical lists, not a
  3-column grid, and cannot cross grid↔list surfaces). Both reuse existing
  theme tokens.

## Project Structure

### Documentation (this feature)

```text
specs/1045-rearrange-pinned-chats/
├── spec.md              # Feature specification (done)
├── plan.md              # This file
├── research.md          # Phase 0: decisions & alternatives
├── data-model.md        # Phase 1: Chat.pinnedRank semantics
├── quickstart.md        # Phase 1: how to run/verify locally
├── checklists/
│   └── requirements.md  # Spec quality checklist (done)
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── utils/
│   ├── chat-pins.ts             # EXTEND: rank comparator, insert/renumber helpers
│   ├── chat-pins.test.ts        # EXTEND: rank ordering + reorder math tests
│   ├── drag-math.ts             # NEW: pure hit-testing/slot math for the drag
│   └── drag-math.test.ts        # NEW: unit tests
├── db/
│   ├── types.ts                 # EXTEND: Chat.pinnedRank?: number
│   └── queries.ts               # EXTEND: rank-aware chatOrder, setChatPinned(atRank),
│                                #         setPinnedOrder(), ensurePinRanks()
├── composables/
│   └── useChatDrag.ts           # NEW: lift/drag/drop + peek-timer state machine
├── components/
│   ├── PinnedChatsGrid.vue      # EXTEND: drag source/target, gap preview, lift visuals
│   ├── ChatListItem.vue         # EXTEND: long-press lift (avatar proxy) + peek trigger
│   └── ChatPeekOverlay.vue      # NEW: message peek + Pin/Unpin, Unread/Read, Delete menu
└── views/tabs/
    └── ChatsPage.vue            # EXTEND: hosts drag controller + peek overlay

e2e/
└── pinned-reorder.spec.ts       # NEW: reorder persists; peek open/act/dismiss
```

**Structure Decision**: All work is in the existing client tree; the drag state
machine lives in a composable owned by `ChatsPage.vue` because the gesture
crosses two components (grid tiles and list rows) and must coordinate a single
floating proxy, one active gesture, and page-level auto-scroll.

## Design Decisions (Phase 0 summary — full trail in research.md)

1. **Order storage: `pinnedRank?: number` per chat** (not an ordered-ids array
   in settings). It inherits the pin's own sync/LWW/tombstone story, can't
   drift from `pinned` membership, and partitions cleanly. Ties/gaps are
   tolerated: sort key is `(pinnedRank ?? ∞, then recency)`; every local
   rearrange renumbers 0..n-1.
2. **Legacy pins**: `ensurePinRanks()` stamps missing ranks once (in current
   visual order) when the Chats tab mounts, making order stable from the first
   run of this build.
3. **Hand-rolled pointer-event drag** (no library, no HTML5 DnD — poor touch
   support; no `ion-reorder-group` — vertical lists only). One controller:
   pointerdown starts a 350 ms lift timer; >8 px movement before lift cancels
   (scroll/swipe win); after lift, a floating avatar proxy follows the pointer
   (transform only), grid slot from `elementsFromPoint`-free rect math,
   placeholder gap animates via CSS. Holding ~550 ms past the lift with no
   drag opens the peek instead.
4. **Peek overlay**: fixed overlay + `ion-backdrop`; card shows the last ~15
   messages via `listMessagesOlder(chatId, null, 15)` rendered as minimal
   bubbles (text via `EmojiText`, media/other kinds as icon + label via
   `mediaPreview`, deleted/expired placeholders); menu is an inset `ion-list`
   with Pin/Unpin, Mark as Unread/Read, Delete (+ **More…** opening the
   existing ChatActionsSheet so pinned chats keep Mute/Hide/Lock etc. on touch,
   where this gesture replaces the old long-press-for-sheet).
5. **Scroll discipline**: while lifted, a non-passive `touchmove` preventDefault
   plus pointer capture stops page scroll; near-edge auto-scroll of the
   `ion-content` scroll element keeps far-down rows pinnable.
6. **Cap behaviour**: dragging a row over the grid with 9 pins shows a
   `ban`-icon badge on the proxy's top right; drop is a no-op (FR-007).

## Complexity Tracking

No constitution violations. The only bespoke UI (floating drag proxy, peek
card) is justified under Principle XI in the Constitution Check above.
