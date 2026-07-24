# Implementation Plan: Message status and presence on the chat list

**Branch**: `feat/1062-list-status-presence` | **Date**: 2026-07-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/1062-list-status-presence/spec.md`

## Summary

Surface information Ring already computes but only shows inside a conversation onto the Chats list, pinned tiles, and group headers: the last outgoing message's delivery tick, the online presence dot, and — for groups — an honest online count plus per-member dots. The work is **client-only**: no server change, no new wire contract. Every piece reuses an existing primitive (the conversation's tick glyphs, the `.presence-dot`, the contact-gated presence map, the typing/recording activity override). The one new data touch is a small computed "last outgoing tick" denormalized onto the existing Chat summary; the one design refinement is that group online counts are composed from presence the client **already** has (contacts are already subscribed), so no meaningful new subscription traffic is introduced.

## Technical Context

**Language/Version**: TypeScript 5 (Vue 3 `<script setup>` + Ionic), client only. No Go changes.

**Primary Dependencies**: Vue 3, Ionic, `ionicons`; existing modules — `src/services/message-status.ts` (pure status reducers, `groupProgress`), `src/composables/usePresence.ts`, `src/composables/useLiveQuery.ts`, `src/composables/useSync.ts` (presence subscription), `src/db/queries.ts` (chat-summary maintenance).

**Storage**: IndexedDB `chats` store. One additive, computed field on the Chat summary (`lastTick`). IndexedDB records are schemaless per-record, and no new object store or index is introduced, so **no `DB_VERSION` bump and no migration** (Principle V): the field is populated by the same code paths that already maintain `lastMessage`, and is computed on read for any legacy record that predates it.

**Testing**: vitest for the new pure helpers (tick tier + group-count derivation); `drive/` scenarios for visual confirmation (list ticks, tile corners, group dots); Playwright `e2e/` for behavioral coverage of a status advancing on the list and a member's dot matching the header count (Principle III — user-facing behavior extends e2e).

**Target Platform**: Installable PWA (iOS/Android/desktop).

**Project Type**: Web app, single client project (repo root `src/`).

**Performance Goals**: Chat list stays smooth (no per-row async lookups — the tick is denormalized, not queried per row); group count/dots are O(members) pure reads over the in-memory presence map, recomputed reactively.

**Constraints**: Zero-knowledge preserved (no server group knowledge, no new server primitive); presence stays ephemeral (never persisted/synced); reciprocity honored (`privacy.seenReceipts`, `privacy.online`, `privacy.lastSeen`); Ionic-first (reuse `ion-icon`, `.presence-dot`, `--ring-*` tokens).

**Scale/Scope**: Chat list of tens of rows; groups up to Ring's realistic member counts. Four independently shippable UI slices (P1–P4).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I — Zero-Knowledge (NON-NEGOTIABLE)**: PASS. No client/server boundary change. Group presence is composed entirely client-side from the existing per-user, contact-gated presence map; the server never learns group membership and gains no new endpoint. A non-contact co-member is never counted (the server won't reveal their presence and the client won't invent it). A dedicated **Zero-Knowledge Impact** section is added to the spec. Because this spec touches Principle I, **`/speckit-checklist` is REQUIRED** before `/speckit-implement` (tracked below).
- **II — Spec-Driven**: PASS. Following specify → clarify(pre-done) → plan (this) → tasks → analyze → checklist → taskstoissues → implement.
- **III — TDD**: PASS (planned). Pure helpers (`lastMessageTick`, `groupOnline`) get failing vitest first; the four UI slices each extend an e2e/drive scenario for the user-facing behavior. No crypto/store/HTTP logic changes.
- **V — Offline-First**: PASS. Additive computed Chat field, no store/index addition → no `DB_VERSION` bump, no migration; reactivity rides the existing `chats` live query.
- **VII — Quality Gates**: PASS (planned). `npm run build` + vitest + e2e where behavior changed; commit subjects written as plain-language release-note copy.
- **IX — Privacy/Data-Minimization**: PASS. Uses strictly less than the server already gates; no new data collected or transmitted.
- **X — Accessibility/i18n**: PASS. Count strings ("N online" / "N online contacts") are short, bidi-safe text; dots/ticks carry `aria-hidden` like the existing ones; contrast via `--ring-*`/success token.
- **XI — Ionic-First**: PASS. Ticks render through `ion-icon` (a shared `MessageTick` composed from it); presence dots reuse the existing `.presence-dot` styling; group count lives in existing text slots (`ion-note`, the conversation subtitle). No bespoke widgets.

**No violations → Complexity Tracking is empty.**

## Project Structure

### Documentation (this feature)

```text
specs/1062-list-status-presence/
├── plan.md              # This file
├── research.md          # Phase 0 — key decisions (denormalized tick, no-new-subscription count)
├── data-model.md        # Phase 1 — Chat.lastTick, derived group-online view
├── quickstart.md        # Phase 1 — how to build/verify each slice
├── contracts/
│   └── README.md        # Internal UI/helper contracts + the (unchanged) presence WS usage
├── checklists/
│   └── requirements.md   # Spec quality checklist (done); ZK checklist added at /speckit-checklist
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── services/
│   └── message-status.ts        # + pure lastMessageTick() tier helper (extract the ChatDetailPage
│                                 #   tickInfo/statusIcon logic here so all surfaces share one source)
├── composables/
│   ├── usePresence.ts           # (unchanged) contact-gated presence map
│   ├── useGroupPresence.ts      # NEW small composable: online count + labeling + per-member set
│   │                            #   for a group, derived from participantIds ∩ online contacts
│   └── useSync.ts               # (optional) bounded subscribePresence for an open group's members
├── components/
│   ├── MessageTick.vue          # NEW tiny ion-icon wrapper (tier → glyph + .seen blue); reused by
│   │                            #   ChatDetailPage, ChatListItem, PinnedChatsGrid
│   ├── ChatListItem.vue         # + tick in preview row (outgoing last msg); + group online text
│   └── PinnedChatsGrid.vue      # + tick bottom-left, presence dot bottom-right; + group count
├── views/
│   └── detail/
│       └── ChatDetailPage.vue   # use MessageTick (dedupe); group header shows online count;
│                                #   per-member online dot on sender avatars (activity overrides)
└── db/
    ├── types.ts                 # + Chat.lastTick?: LastTick (computed, optional)
    └── queries.ts               # maintain lastTick where lastMessage is maintained; bump it when a
                                 #   receipt advances the last outgoing message's status
```

**Structure Decision**: Single client project at repo root `src/`. This is a presentation-layer feature: one pure-helper extraction (`message-status.ts`), one tiny shared component (`MessageTick.vue`), one small composable (`useGroupPresence.ts`), and edits to the three surfaces that render chats (`ChatListItem`, `PinnedChatsGrid`, `ChatDetailPage`). The only data-layer touch is denormalizing a computed tick onto the Chat summary in `queries.ts`.

## Phase 0 — Research

See [research.md](./research.md). Decisions resolved:

1. **Last-message tick data path** — denormalize a compact `lastTick` onto the Chat summary (updated where `lastMessage` is maintained, and bumped when a receipt advances the last outgoing message), rather than per-row message lookups. Keeps the list render synchronous and reactive via the existing `chats` live query.
2. **Tick logic reuse** — extract the inline `tickInfo`/`statusIcon` from `ChatDetailPage.vue` into a pure `lastMessageTick()` in `message-status.ts` returning a tier (`pending|sent|delivered|seen|failed|none`), with a shared `MessageTick.vue` doing the `ion-icon` rendering. One source of truth for all four surfaces.
3. **Group online count needs (almost) no new subscription** — the server reveals presence only for your contacts, and the client already subscribes to all contacts, so presence for every group member you are *permitted* to see is already in the map. The count is `participantIds ∩ {online contacts}`; "all contacts" vs "mixed" wording is decided by whether every member is in your contact set. Optional, bounded `subscribePresence(openGroupMemberIds)` only to catch the rare inbound-only contact edge — scoped to the open conversation, never the whole list.
4. **Labeling** — `N online` when every member is a contact; `N online contacts` for mixed; render nothing when N is 0/unknown. Compact form on tile/row, fuller form in the header.
5. **Per-member dots (Story 4)** — reuse `.presence-dot` scaled to the in-conversation avatar; `activityFor(member)` already overrides presence, satisfying "when none are interacting with the composer".

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — the `LastTick` shape and the derived `GroupOnline` view (both computed; nothing new persisted server-side, nothing new synced).
- [contracts/README.md](./contracts/README.md) — internal contracts for `lastMessageTick()`, `useGroupPresence()`, and `MessageTick.vue`, plus a note that the presence WebSocket usage (`presence-sub`/`presence`) is unchanged.
- [quickstart.md](./quickstart.md) — build/typecheck/test and the drive + e2e verification recipe per slice.

### Zero-Knowledge Impact (added to spec)

What crosses the wire: nothing new. Group membership stays client-only (sender keys); presence stays the existing per-user, contact-gated `presence-sub`/`presence` frames. The group count and dots are pure client-side composition over presence the client already receives. No server endpoint, table, log, or metric is added or changed. A co-member who is not your contact is invisible to you by construction, so the "honest partial count" cannot leak more than the 1:1 contact graph already does.

## Complexity Tracking

No constitutional violations — no entries.
