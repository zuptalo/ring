# Research: Quick Call tiles + totals move (spec 1046)

## D1 — Where does the quick-call list live?

- **Decision**: A settings-ledger key `calls.quick` holding the ordered entry
  array, added to `SYNCED_PREF_KEYS` (ownsync-keys.ts).
- **Rationale**: Entries are user preferences over existing records — exactly
  the `chats.tabFilters` shape (array-valued synced setting, whole-value LWW).
  No new object store, no DB_VERSION bump, sync + encryption for free.
- **Alternatives**: a field per contact/chat record (like `pinned`) — spreads
  one list across two stores and two record types, and group entries would
  write to chat records that other features watch; a new IndexedDB store —
  DB_VERSION bump + own sync plumbing for a ≤8-item list. Both rejected.

## D2 — What can be a target?

- **Decision**: v1 targets are (a) contacts and (b) existing group chats
  visible in `listChats()` (which already excludes hidden/archived/locked and
  pending). Ad-hoc member sets (the New-group-call picker flow) are out of
  scope; that flow keeps its toolbar button.
- **Rationale**: Groups give `startGroupCall` everything it needs (room id,
  name, avatar, members) and membership auto-updates as the group changes; an
  ad-hoc set would need its own naming/updating story. Contacts cover the
  person case without touching (possibly hidden) 1:1 chats — `startDirectCall`
  resolves the session chat itself, preserving spec-1027 knock-knock semantics.

## D3 — Cap enforcement points

- **Decision**: One pure helper set in `src/utils/quick-calls.ts`:
  `callSize(entry, target)` (group = members + self, contact = 2),
  `allowedKinds(size)` (video iff ≤ VIDEO_MAX, audio iff ≤ AUDIO_MAX),
  `entryVerdict(entry, contactOrChat)` → `ok | no-video | no-audio | missing |
  ghosted | blocked`. Applied at ADD (picker offers only allowed kinds; > 8
  groups listed disabled with the audio-cap reason), at SWITCH (sheet option
  disabled with reason), and at TAP (re-derive before ringing; on failure show
  the reason with "Switch to audio" (if allowed) / "Remove" actions).
- **Rationale**: Groups change size after the entry is created, so add-time
  validation alone would eventually produce the exact "call full" surprise the
  spec forbids (SC-002/003). Reusing `VIDEO_MAX`/`AUDIO_MAX` + capacity.ts
  phrasing keeps one voice for limit copy.

## D4 — Tile UI

- **Decision**: `QuickCallsRow.vue`: horizontal wrap grid of avatar tiles
  (64px avatars — smaller than the 88px pinned grid, they're action buttons
  not content), method glyph (call/videocam) in a primary-tinted corner badge,
  name below; trailing "+" tile → add picker modal hosted by CallsPage.
  Long-press (500 ms timer + click swallow, the pre-1045 grid pattern) or
  contextmenu → `ion-action-sheet`: "Switch to video/audio" (disabled +
  reason when capped), "Remove". No drag, no peek (out of scope).
- **Rationale**: Familiar pattern (pinned grid) at lower complexity; an action
  sheet is the stock Ionic surface for 2–3 actions (Principle XI).

## D5 — Invalid targets at render

- **Decision**: Resolve entries against live `contacts`/`chats` queries.
  Unknown id → tile hidden (sync raced local data; it appears when the record
  lands). Ghosted/blocked contact or over-cap group → tile shown dimmed with a
  warning glyph; tap opens the manage sheet with the reason (no ringing).
- **Rationale**: Hiding known-but-broken entries would make them unremovable
  from this device; showing them un-dimmed would break the "tap always rings
  or explains" contract.

## D6 — Totals move semantics

- **Decision**: Extend `networkStats` (queries.ts) with per-kind fields
  (`audioCallSeconds/videoCallSeconds/audioCallBytes/videoCallBytes`) computed
  from the SAME call set/window as its existing counters, and render "Audio
  calls" / "Video calls" rows (X min · Y MB) in NetworkUsagePage's Media &
  calls section. Remove the Totals block from CallsPage (template, queries,
  imports).
- **Rationale**: FR-008 says the rows honour "Reset statistics", and the page
  must stay internally consistent: audio + video must equal the existing
  "Call data"/"Total call time" rows, which `networkStats` feeds. Splitting the
  source (e.g. the Calls tab's hidden-call-excluding `listCallsForTotals`)
  would make rows on the SAME page disagree.
- **Semantic changes vs the old Calls-tab block (deliberate)**: the window is
  since-reset (was all-time; never resetting preserves all-time), and hidden
  calls are included in the aggregates exactly as the page's existing call
  counters always included them (aggregate totals attribute nothing to any
  chat, so spec-1019 concealment is not weakened beyond the page's
  long-standing behaviour).

## D7 — e2e approach

- **Decision**: One spec: seed A+B+C, group of A/B/C; add a contact quick call
  (video) and a group quick call (audio) via the picker UI; assert tap starts
  ringing (existing `waitCallState` helpers); assert the picker/switch honours
  caps with a group inflated past VIDEO_MAX via `__ringTest` members; assert
  NetworkUsagePage shows the per-kind rows and CallsPage shows no Totals.
  Real ringing uses the fake-media flags the call suite already relies on;
  2-account ringing only (no 3-way video mesh — CI flakiness memory).
