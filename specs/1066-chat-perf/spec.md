# Feature Specification: Chat scroll and emoji rendering performance

**Feature Branch**: `feat/1066-chat-perf`

**Created**: 2026-09-16

**Status**: in-progress

**Input**: User description: "Chat history scroll feels laggy on phone; cached animated emoji take long to appear when reacting; scrolling far up in a long chat jumps back to the end; sluggishness is worse when both parties are typing."

## Background

Three user-visible symptoms were traced to two root causes plus one correctness bug.

1. **Emoji cost.** `Emoji.vue` requests `/v1/emoji/{cp}/512.webp` — a 512x512 *animated*
   WebP — and renders it at `1.2em` (~23 CSS px). The default quick-react set totals
   **1.78 MB**; a single 😂 is 624 KB. Animated WebP decodes every frame at full
   512x512 on the main thread before downscaling, so every reaction pill in the
   history decodes continuously while scrolling. The same upstream serves
   `emoji.svg` (22.6 KB for the same five emoji — 79x smaller), which is vector,
   rasterises once at display size, and additionally covers emoji that have **no**
   animated WebP at all (flags, ZWJ sequences currently 404 → native glyph).

2. **No per-row render boundary.** Message rows are inline in `ChatDetailPage.vue`
   (one component), so any reactive change re-renders all rows, re-running
   `bodyParts()` (link + mention + contact + emoji tokeniser) and `groupedReactions()`
   per row. `useTyping.activityFor()` iterates a `reactive(Map)`, which registers a
   dependency on the *whole* collection, so one typing keepalive (every 3 s) or
   expiry (6 s) invalidates the entire list — and `memberOnline()` calls it once per
   rendered row.

3. **Scroll-jump bug.** `loadOlder()` trims the newest tail once the run exceeds
   `MAX_ROWS`. That mutates `rows[rows.length - 1]`, which is exactly the key the
   auto-follow watcher in `ChatDetailPage.vue` watches. The watcher cannot distinguish
   "a new message arrived" from "the tail was trimmed", so when the post-trim tail row
   is `outgoing` it calls `scrollToNewest()` and throws the reader to the bottom.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scrolling far back stays where I put it (Priority: P1)

Reading back through a long chat, I keep scrolling up past several days of history.
The view stays where I scrolled it. It never jumps back to the newest message on its own.

**Why this priority**: A correctness bug that loses the reader's place. It makes long
history effectively unusable and is the most disruptive of the three symptoms.

**Independent Test**: Scroll a chat with > 200 loaded messages upward past four
`loadOlder` batches so the tail trim fires with an outgoing message at the new tail;
the scroll position must not move.

**Acceptance Scenarios**:

1. **Given** a chat with more than `MAX_ROWS` messages and at least one outgoing
   message in the trimmed region, **When** the reader scrolls up far enough to trigger
   a newest-tail trim, **Then** the scroll position is unchanged and no auto-follow runs.
2. **Given** the reader is scrolled up with newer messages unloaded, **When** a trim
   changes the last loaded row, **Then** `scrollToNewest()` is not called.
3. **Given** the reader is pinned at the bottom, **When** a genuinely new message
   arrives, **Then** auto-follow still runs and the arrival glide still plays.

### User Story 2 - Reacting is instant (Priority: P1)

I long-press a message and the quick-react bar appears with its emoji already drawn.
Reaction pills in the history draw immediately as I scroll.

**Why this priority**: The 1.78 MB quick-set download is the direct cause of the
reported delay, and the per-frame decode of those same assets is a major scroll cost.

**Independent Test**: Open the quick-react bar on a cold cache and measure bytes
transferred and time to first paint of the five emoji.

**Acceptance Scenarios**:

1. **Given** a cold cache, **When** the quick-react bar opens, **Then** total emoji
   bytes transferred are under 64 KB (from 1.78 MB).
2. **Given** an emoji with no animated WebP (a flag, a ZWJ sequence), **When** it is
   shown as a reaction pill, **Then** the Noto artwork renders rather than falling back
   to the platform glyph.
3. **Given** emoji animation is enabled in settings, **When** an emoji is shown at a
   large size (single-emoji message, avatar), **Then** it still animates as before.

### User Story 3 - Typing does not make the chat stutter (Priority: P2)

When the other person is typing — or we are both typing — scrolling the history stays
as smooth as when nobody is typing.

**Why this priority**: The amplifier that turns an already-costly render into visible
stutter, on a 3-second cadence for as long as anyone is composing.

**Independent Test**: Drive two accounts, have one type continuously, and scroll the
other's history; compare frame timing against a quiet baseline.

**Acceptance Scenarios**:

1. **Given** a peer is typing, **When** an activity keepalive or expiry fires,
   **Then** message rows whose content is unchanged are not re-rendered.
2. **Given** a group chat, **When** the list renders, **Then** activity state is read
   once per render rather than once per row.
3. **Given** activity indicators are disabled in settings, **When** a peer types,
   **Then** behaviour is unchanged from today.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The auto-follow watcher MUST distinguish an appended newest row from a
  receded (trimmed) tail, and MUST NOT auto-follow on a trim.
- **FR-002**: The auto-follow watcher MUST NOT auto-follow while newer rows are
  unloaded, since the last loaded row is then not the chat's newest message.
- **FR-003**: Pinned-to-bottom auto-follow, the arrival pop, and the arrival glide MUST
  continue to work for genuinely new messages.
- **FR-004**: The server emoji proxy MUST serve `emoji.svg` and `512.png` in addition to
  `lottie.json` and `512.webp`, under the same SSRF-safe path validation and the same
  Postgres cache.
- **FR-005**: Emoji rendered at pill size (reaction pills, quick-react bar) MUST use the
  static vector asset, not the animated WebP.
- **FR-006**: Emoji animation at large sizes MUST be unchanged when the setting is on.
- **FR-007**: `activityFor()` MUST NOT register a dependency on the whole activity
  collection; a change in one conversation MUST NOT invalidate readers of another.
- **FR-008**: Per-row activity/presence reads MUST be hoisted out of the row loop.
- **FR-009**: `bodyParts()` and `groupedReactions()` MUST NOT re-run for a message whose
  content has not changed.
- **FR-010**: Message rows MUST skip re-render when their inputs are unchanged.
- **FR-011**: The scroll handler MUST NOT force synchronous layout on every scroll event.
- **FR-012**: The zero-knowledge boundary is untouched: no change to what the server
  sees. Emoji art is public, non-user data and already proxied.

### Non-Functional Requirements

- **NFR-001**: Quick-react bar cold-cache emoji transfer under 64 KB (from 1.78 MB).
- **NFR-002**: No regression in existing e2e coverage for chat scroll, reactions,
  activity indicators, or emoji settings.

## Out of Scope

- **The sliding render window.** `src/utils/chat-window.ts` defines `ROW_CAP`,
  `computeWindow`, `initialWindow` and `shiftWindow`, which are referenced only by
  their own unit test — the view renders the whole loaded run (`MAX_ROWS` = 200)
  rather than the intended `ROW_CAP` (100). Wiring it up would rewrite the top/bottom
  spacer and `withScrollAnchor` delta maths that US1 is fixing a bug inside, and
  spec 1011 documents that invariant as the fragile one. FR-009/FR-010 remove most of
  its benefit (unchanged rows cost nothing to re-render). Deferred to its own spec so
  it can be measured and reverted independently.
