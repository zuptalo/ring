# Implementation Plan: @mentions in group chats

**Branch**: `feat/1020-mentions-group-chats` | **Date**: 2026-06-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/1020-mentions-group-chats/spec.md`

## Summary

Add @mentions to group chats: a composer `@`-autocomplete over group members, a mention
encoded **inside the E2EE message payload** (member ids + an admin-only `@everyone` flag),
recipient-side rendering of a tappable mention chip, and — the core value — **recipient-side
notification escalation** that lets a mention break through a muted chat (and override the
per-chat content level) while still respecting the global "Show notifications" master, the
OS DND, and a new per-chat "Notify for mentions even when muted" toggle (default on). Plus
Telegram-style visual indicators: an "@" chat-row marker, a separate unread-mentions count,
and jump-to-mention. **Server change: none** — the server keeps relaying opaque ciphertext
and content-free pushes; all mention logic is client-side.

## Technical Context

**Language/Version**: TypeScript (ES modules), Vue 3 `<script setup>` + Ionic; Go 1.26 server (untouched).

**Primary Dependencies**: libsodium (existing crypto), IndexedDB via `src/db/idb.ts`, the shared `notificationOwner` policy (`src/services/notify-policy.ts`).

**Storage**: IndexedDB (schemaless JSON stores — additive optional fields, no `DB_VERSION` bump needed). Per-chat prefs ride the existing encrypted own-data sync.

**Testing**: vitest unit (extend `notify-policy.test.ts`), Playwright e2e (multi-account, pattern from `e2e/groups.spec.ts`), `drive/` scenarios for visual checks. CI gates: `npm run build`, `go build/vet/test`, `npm run test:e2e`.

**Target Platform**: Installable PWA (iOS Safari/WKWebView + Chromium); foreground page AND service worker must agree on escalation.

**Project Type**: Single web client (Ring monorepo, client at repo root).

**Performance Goals**: No regressions; @-autocomplete responsive over typical group sizes; notification decision stays O(members) on receive.

**Constraints**: **Zero-knowledge** (Constitution Principle I) — mention targets never cross the wire in cleartext; escalation computed only on-device after decrypt. Offline-first. No server-visible mention concept.

**Scale/Scope**: Group chats only; member-list-sized autocomplete; one new payload field group; a handful of new optional DB fields; ~6 UI/logic touch-points.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Zero-knowledge boundary (non-negotiable)**: PASS by design. Mentions live in the sealed `MessagePayload`; the server stores/relays opaque ciphertext and the existing content-free push. No new server field, route, or push data. `@everyone` admin gating is enforced + re-validated client-side. → **A `/speckit-checklist` (crypto/ZK) is REQUIRED before implement.**
- **II. TDD mandate**: PASS — plan leads each slice with tests (notify-policy unit first; e2e muted-group-mention; drive visual).
- **III. Offline-first / IndexedDB source of truth**: PASS — additive optional fields; unread-mention state derived locally; pref synced via own-data sync.
- **VII. Release-note discipline**: PASS — user-facing commits will carry benefit-focused subjects.
- **No server change**: PASS — server untouched; `go` gates remain green trivially.

**Risk flagged (not a violation, a scope correction)**: the spec assumed group **admin/owner roles already exist**. They do **not** — groups are all-member parity (see research.md). The minimal, in-boundary resolution is a group **owner** = creator (`createdBy`), used as "admin" for `@everyone` gating in v1. Documented in research.md and data-model.md.

## Project Structure

### Documentation (this feature)

```text
specs/1020-mentions-group-chats/
├── plan.md              # This file
├── research.md          # Decisions (roles gap, payload shape, escalation hook, seen semantics)
├── data-model.md        # Payload + Message/Chat field additions, unread-mention state
├── quickstart.md        # How to exercise/verify the feature (drive + e2e)
├── contracts/
│   └── payload.md       # The mention payload contract + escalation decision table
├── checklists/
│   └── requirements.md  # Spec quality (done)
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (touch-points, repository root)

```text
src/services/crypto/message.ts     # MessagePayload: + mentions?, mentionsEveryone?; seal/open
src/services/messaging.ts          # carries the payload (no shape change beyond the above)
src/db/types.ts                    # Message: + mentions?, mentionsEveryone?
                                   # Chat:    + unreadMentions?, notifyMentions?, createdBy?
src/db/queries.ts                  # sendMessage(): attach mentions; receiveIncomingInner():
                                   #   detect self-mention -> unreadMentions; markChatRead():
                                   #   clear it; getChatNotifyPrefs/setChatNotifyPrefs:+notifyMentions;
                                   #   createGroup(): stamp createdBy; isGroupOwner() helper;
                                   #   group member list for autocomplete; count* badge plumbing
src/services/notify-policy.ts      # NotifyInput.pref + isMention; escalation in notificationOwner
src/services/notify.ts             # pass isMention into the policy; mention banner copy
src/services/sw-inbox.ts           # noteForPayload: mention detection -> escalate + "X mentioned you"
src/sw.ts                          # (push path already routes through sw-inbox; minimal/none)
src/views/detail/ChatDetailPage.vue# @-autocomplete in composer; mention chip in bubbleParts;
                                   #   jump-to-mention scroll
src/components/ChatListItem.vue    # "@" marker + unread-mentions count on the row
src/components/MentionAutocomplete.vue (new)   # member picker popover
src/views/detail/SettingDetailPage.vue / chat settings  # "Notify for mentions even when muted" toggle
src/services/testhook.ts           # hooks: sendWithMentions, unreadMentions(chatId), isGroupOwner
tests: src/services/notify-policy.test.ts (extend), e2e/mentions.spec.ts (new), drive/scenarios/mention-*.mjs (new)
```

**Structure Decision**: Single client feature; no new top-level dirs. One new component
(`MentionAutocomplete.vue`); everything else extends existing files at the points mapped
in research.md.

## Phased approach (slices map to user stories; each independently testable)

- **Phase A — Payload + data (foundation for all)**: add `mentions?`/`mentionsEveryone?` to
  `MessagePayload` (seal/open) and to the local `Message`; add `unreadMentions?`,
  `notifyMentions?`, `createdBy?` to `Chat`. Unit: payload round-trips mentions; ZK check
  that nothing new leaves the wire.
- **Phase B — Compose & send (US1 sender)**: `@`-autocomplete over `participantIds`
  (`MentionAutocomplete.vue`); insert a mention token; `send()`/`sendMessage()` extract +
  attach `mentions`. Render the mention chip in `bodyParts()` (self-mention emphasized).
- **Phase C — Receive, detect & ESCALATE (US1 recipient — the core)**: on receive, detect
  self-mention/honored-`@everyone`; thread `isMention` into `notificationOwner` so a mention
  flips a muted `suppress`→`page-banner`/`sw-notification` and a `content:'none'`→ shows the
  sender, gated by `notifyMentions` and still under the global master + OS DND. Apply on BOTH
  the foreground (`notify.ts`) and SW (`sw-inbox.ts noteForPayload`, "Alice mentioned you")
  paths. Unit: notify-policy escalation table. e2e: muted group, mentioned vs not.
- **Phase D — Indicators & jump-to (US2)**: `unreadMentions` increments on receive, clears
  on the existing read/seen path; "@" marker + count on `ChatListItem`; jump-to-mention scroll
  in `ChatDetailPage`. drive: visual marker + jump.
- **Phase E — Per-chat toggle (US3)**: `notifyMentions` (default true) in `ChatNotifyPrefs` +
  chat settings UI; honored by C's escalation.
- **Phase F — Admin `@everyone` (US4)**: minimal owner = `createdBy` (stamped in `createGroup`,
  carried in the group card so recipients know the owner); offer `@everyone` only to the owner;
  recipients re-validate sender == owner before honoring. e2e: owner vs non-owner.

## Testing strategy

- **Unit (TDD-first)**: extend `notify-policy.test.ts` with an escalation matrix —
  {muted, content:none/full, appVisible, isMention, notifyMentions, webPush} → expected owner.
  This is the single source of truth both the page and SW consume, so it pins the core behavior.
- **e2e (`e2e/mentions.spec.ts`)**: 3-account group; recipient mutes; sender mentions →
  recipient gets a banner/notification, third member does not; toggle off → no escalation;
  owner `@everyone` notifies all, non-owner `@everyone` ignored; jump-to + marker clear.
  Add `window.__ringTest` hooks (sendWithMentions, unreadMentions, isGroupOwner).
- **drive (`drive/scenarios/mention-*.mjs`)**: visual — chip rendering (self-emphasized),
  the "@" row marker + count, jump-to-mention scroll.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|------|-----------|--------------------------------------|
| Introduce group `createdBy` (owner) | `@everyone` is admin-only but **no role concept exists** today | Allowing anyone to `@everyone` contradicts the locked decision; a full roles system is far larger than this spec and unneeded for v1 — a single owner is the minimal gate. |
| `isMention` added to the shared notify-policy input (not a new policy) | Foreground + SW MUST agree on escalation | Duplicating escalation logic in `notify.ts` and `sw-inbox.ts` would drift (the exact bug the shared predicate exists to prevent). |
