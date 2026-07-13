# Implementation Plan: Quick Call tiles on the Calls tab, usage totals move to Network usage

**Branch**: `feat/1046-quick-call-tiles` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/1046-quick-call-tiles/spec.md`

## Summary

A `calls.quick` synced setting holds an ordered list of Quick Call entries
(`{t: 'contact'|'group', id, kind: 'audio'|'video'}`). The Calls tab renders
them as a tile row above Recent; a tap starts the call immediately via the
existing `startDirectCall` / `startGroupCall`, re-validating the target and the
capacity caps (pure helpers in `call/capacity.ts`) at every decision point
(add, switch, tap). The Calls-tab Totals block moves into
`NetworkUsagePage.vue` as per-kind rows computed by the existing
`computeCallTotals`. Client-only; no server or crypto changes.

## Technical Context

**Language/Version**: TypeScript 5 / Vue 3 `<script setup>` + Ionic 8 (client only)

**Primary Dependencies**: Existing app stack — `useCall` (`startDirectCall`,
`startGroupCall`, busy guard, `ensureProfile` for group calls),
`call/capacity.ts` (`VIDEO_MAX`/`AUDIO_MAX`, reason copy), settings ledger
(`getSetting`/`setSetting`) + `SYNCED_PREF_KEYS` sync allowlist,
`useLiveQuery`, `computeCallTotals`. No new dependencies.

**Storage**: One new settings key `calls.quick` (array value, like
`chats.tabFilters`) in the existing `settings` store — no new object store, no
DB_VERSION bump. Synced by adding the key to `SYNCED_PREF_KEYS` (sealed
snapshot, LWW).

**Testing**: vitest for the new pure module `src/utils/quick-calls.ts`
(allowed-kinds per target size, dedupe/upsert, invalid-target verdicts);
Playwright e2e for add→tap→ringing, cap gating, and the totals move;
`npm run build` typecheck gate.

**Target Platform**: Installable PWA, touch + desktop.

**Project Type**: Web app (client half of the monorepo; zero server changes).

**Performance Goals**: Tile row renders from data the page already live-queries;
tap-to-ring adds no work beyond today's call start.

**Constraints**: Zero-knowledge unchanged (entries ride the sealed settings
snapshot). Caps enforced pre-emptively with the existing kind-specific copy —
a quick-call tap must never produce a server `call-full`. Hidden-chat rules:
the picker lists contacts and VISIBLE groups only (`listChats` is the choke
point); contact quick calls carry no chat linkage.

**Scale/Scope**: Entries soft-capped at 8 tiles (one clean pair of rows, like
the 9-pin grid); two pages touched, one new component, one new pure module,
one settings-key addition.

## Constitution Check

*GATE: passed before Phase 0; re-checked after design.*

- **I. Zero-Knowledge Boundary** — PASS. New data lives in the sealed synced
  settings snapshot; call starts reuse existing sealed signalling. Spec carries
  the Zero-Knowledge Impact section.
- **II. Spec-Driven Development** — PASS. Spec 1046 (ad-hoc), this plan, tasks
  to follow; `taskstoissues` deferred until after the user's local test round
  (same explicit instruction as spec 1045), issues before PR.
- **III. TDD** — PASS. `quick-calls.ts` pure helpers get red-first vitest
  coverage; e2e extends behavioral coverage; tasks order tests first.
- **IV. Crypto Discipline** — N/A (no crypto changes).
- **V. Offline-First Data Integrity** — PASS. Settings write path via existing
  `setSetting`; no store/DB_VERSION change.
- **VI. Stateless Server** — N/A (server untouched).
- **VII. Quality Gates** — PASS. Build/vitest/e2e planned; release-note-style
  commit subjects.
- **X. Accessibility & i18n** — PASS. Tiles are labelled buttons; method has
  text equivalents in the manage sheet; RTL-safe (logical props, `dir="auto"`).
- **XI. Ionic-First UI** — PASS with one justified custom piece: the avatar
  tile row (no Ionic primitive renders an avatar tile grid; pattern shared
  with the pinned-chat grid). Management surfaces are stock
  `ion-action-sheet`/`ion-modal`/`ion-list`; Network-usage rows are stock
  `ion-item`s.

## Project Structure

### Documentation (this feature)

```text
specs/1046-quick-call-tiles/
├── spec.md              # done
├── plan.md              # this file
├── research.md          # decisions & alternatives
├── data-model.md        # calls.quick entry shape + validation rules
├── quickstart.md        # run/verify locally
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── utils/
│   ├── quick-calls.ts          # NEW: pure entry logic (allowed kinds, upsert,
│   │                           #      resolve, invalid-target verdicts)
│   └── quick-calls.test.ts     # NEW: unit tests (red first)
├── services/
│   └── ownsync-keys.ts         # EXTEND: + 'calls.quick'
├── components/
│   └── QuickCallsRow.vue       # NEW: tile row + add tile + manage sheet wiring
├── views/
│   ├── tabs/CallsPage.vue      # EXTEND: render QuickCallsRow, REMOVE Totals,
│   │                           #         host the add-picker modal
│   └── detail/NetworkUsagePage.vue  # EXTEND: per-kind call rows (reuse
│                                    #         computeCallTotals + resetAt)
e2e/
└── quick-calls.spec.ts         # NEW: add/tap/cap/remove + totals moved
```

**Structure Decision**: mirror of the pinned-grid split — pure logic in a
dependency-free util (unit-testable), one presentational component, the tab
page as the host. The settings ledger (not a new store) holds the list because
entries are preferences over existing records, exactly like `chats.tabFilters`.

## Design Decisions (full trail in research.md)

1. **Storage**: `calls.quick: QuickCallEntry[]` setting, added to
   `SYNCED_PREF_KEYS`. Whole-list LWW like `chats.tabFilters` — acceptable for
   a hand-curated list of ≤8.
2. **Targets**: contacts (`startDirectCall(contactId, kind)`) and group chats
   the user can see (`listChats()`-derived → hidden/archived/locked groups are
   never listed; call via `startGroupCall(chat.id, kind, name, avatar,
   participantIds)` behind the same `ensureProfile` gate the chat page uses).
3. **Cap math**: group call size = `participantIds.length + 1` (self); a pure
   `allowedKinds(size)` derives options from `VIDEO_MAX`/`AUDIO_MAX`; reason
   strings reuse the capacity.ts copy. Checked at add, at switch, and
   RE-CHECKED at tap (groups grow); a failing tap explains and offers the
   audio fallback / removal.
4. **UI**: tile row above "Recent" — avatar + name + a method glyph badge on
   the avatar corner; a trailing "+" tile opens the add picker (sections:
   Contacts, Groups; the kind step only offers allowed kinds). Long-press
   (simple 500 ms timer — no drag/peek here) or right-click opens the manage
   sheet: Switch to video/audio (blocked with reason when over cap), Remove.
   Tap starts the call; the busy guard toasts as today.
5. **Invalid targets**: resolved at render from live contacts/chats; unknown
   ids are hidden (sync can outrun data), ghosted/blocked contacts and
   over-cap groups render dimmed with a status glyph, and tapping opens the
   manage sheet with the reason instead of ringing.
6. **Totals move**: `NetworkUsagePage` gains "Audio calls" and "Video calls"
   rows (minutes + bytes via `computeCallTotals` over calls since `resetAt` —
   the Calls tab showed ALL-TIME totals; after the move the figures honour the
   reset point like every other row on that page, per FR-008). CallsPage drops
   the Totals list and its now-unused imports.

## Complexity Tracking

No violations. The only bespoke UI is the avatar tile row, justified under
Principle XI above.
