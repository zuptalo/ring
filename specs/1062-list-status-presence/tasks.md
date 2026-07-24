# Tasks: Message status and presence on the chat list

**Feature**: `specs/1062-list-status-presence` | **Branch**: `feat/1062-list-status-presence`

**Input**: plan.md, research.md, data-model.md, contracts/README.md, quickstart.md

Client-only feature (Vue 3 + Ionic PWA). No server, no DB migration. TDD: pure-helper
tests precede their implementations; each user story is an independently shippable slice.

**Story → priority**: US1 = P1 list-row ticks · US2 = P2 pinned-tile corners ·
US3 = P3 group online count · US4 = P4 per-member group dots.

---

## Phase 1: Setup

- [ ] T001 Confirm baseline green before changes: run `npm run build` and `npx vitest run` from repo root; note any pre-existing failures so new work is distinguishable.
- [ ] T002 Add the `LastTick` type and optional `Chat.lastTick?: LastTick` field in `src/db/types.ts` (additive, index-free — no `DB_VERSION` bump), per data-model.md.

## Phase 2: Foundational (blocking prerequisites)

**These unblock every story — the shared tick source of truth.**

- [ ] T003 [P] Write failing unit tests for the pure tick helper in `src/services/message-status.test.ts`: `lastMessageTick(input, seenReceiptsOn)` returns `none` for incoming/absent, `failed` for failed sends, `pending|sent|delivered` mapping for 1:1, caps at `delivered` when `seenReceiptsOn` is false, `seen` only when true, and derives the group tier via `groupProgress`.
- [ ] T004 Implement `lastMessageTick(input, seenReceiptsOn): LastTick` in `src/services/message-status.ts` (extract/lift the tier logic from `ChatDetailPage.vue` `tickInfo`/`statusIcon`) to make T003 pass.
- [ ] T005 Create `src/components/MessageTick.vue` — Ionic-first `ion-icon` wrapper: prop `tier: LastTick` (+ optional `size`), renders `timeOutline`/`checkmark`/`checkmarkDone` with `.tick`/`.tick.seen` (blue `#34b7f1`) styling; renders nothing for `none`/`failed`. Reuse existing tick CSS tokens.
- [ ] T006 Refactor `src/views/detail/ChatDetailPage.vue` to render `MessageTick` (driven by `lastMessageTick`) instead of the inline `tickInfo`/`statusIcon` glyph markup — dedupe to one source of truth; confirm the conversation ticks are visually unchanged (`npm run build`).
- [ ] T007 Maintain `Chat.lastTick` in `src/db/queries.ts`: compute via `lastMessageTick` wherever `lastMessage`/`lastKind`/`lastMessageTime` are set (send/receive), AND when an inbound receipt advances the chat's current last-outgoing message; compute lazily on read for legacy records lacking the field. No new store/index.

**Checkpoint**: shared tick helper + component exist and the conversation view uses them; `Chat.lastTick` is populated reactively.

## Phase 3: User Story 1 — Last-message ticks on Chats list rows (P1) 🎯 MVP

**Goal**: The chat's row shows the outgoing last message's tick (pending→sent→delivered→seen), respecting the seen-receipts gate; nothing when the last message is incoming/failed.

**Independent test**: Send in a 1:1, view the list, watch the row tick advance; confirm no tick when the peer replies last.

- [ ] T008 [US1] Render `MessageTick` in the preview row of `src/components/ChatListItem.vue`, driven by `chat.lastTick`; show only for outgoing (`lastTick` not `none`/`failed`); keep it clear of the unread badge/mention/mute icons.
- [ ] T009 [US1] Ensure reciprocity: the list `seen` tier follows `privacy.seenReceipts` exactly as the conversation does (already encoded in `lastMessageTick` input; wire the flag through where the summary tick is computed in `queries.ts`).
- [ ] T010 [P] [US1] Add a drive scenario `drive/scenarios/list-status-presence.mjs` (US1 section): two accounts DM, assert the sender's list row tick advances sent→delivered→seen and shows none when incoming is last; screenshot light + dark.
- [ ] T011 [P] [US1] Add e2e `e2e/list-status-presence.spec.ts` (US1 case): a list-row tick reaches `seen` after the recipient reads with reciprocity on.

**Checkpoint**: US1 is independently shippable — list rows show live outgoing status.

## Phase 4: User Story 2 — Pinned-tile corners (P2)

**Goal**: Pinned 1:1 tiles show the last-outgoing tick bottom-left and the online dot bottom-right, coexisting with the unread badge.

**Independent test**: Pin a 1:1; tile shows the tick bottom-left; peer comes online → green dot bottom-right; both visible with the unread badge.

- [ ] T012 [US2] Render `MessageTick` at the avatar bottom-left in `src/components/PinnedChatsGrid.vue` (driven by `chat.lastTick`; hidden for `none`/`failed`), positioned on the `position:relative` `.pin-avatar`.
- [ ] T013 [US2] Add the online `.presence-dot` at the avatar bottom-right of the pinned tile for 1:1 chats (reuse the exact CSS from `ChatListItem.vue`; gated on `peerPresence(participantIds[0])?.online`).
- [ ] T014 [US2] Ensure the bottom-left tick, bottom-right dot, and existing unread badge/dot do not overlap and stay legible in light + dark + RTL (CSS only, existing tokens).
- [ ] T015 [P] [US2] Extend `drive/scenarios/list-status-presence.mjs` (US2 section): pin a chat, assert tile tick + online dot render together; screenshot light + dark. AND extend `e2e/list-status-presence.spec.ts` (US2 case) to assert the pinned tile's tick + presence-dot DOM appear together (Constitution III: user-facing behavior gets e2e).

**Checkpoint**: US2 independently shippable — pinned tiles convey status + presence.

## Phase 5: User Story 3 — Group online count (P3)

**Goal**: Groups show "N online" (all-contacts) or "N online contacts" (mixed), nothing at zero, in the group header and a compact form on the list/tile.

**Independent test**: All-contact group with 2 online → "2 online"; add a non-contact member → "2 online contacts"; everyone offline → nothing.

- [ ] T016 [US3] Write failing unit tests for `useGroupPresence` derivation in `src/composables/useGroupPresence.test.ts`: count = members ∩ online-contacts; `allContacts` flips label between "N online" and "N online contacts"; empty label at count 0; non-group → count 0.
- [ ] T017 [US3] Implement `useGroupPresence(chat): ComputedRef<GroupOnline>` in `src/composables/useGroupPresence.ts` (participantIds ∩ contact set ∩ `peerPresence().online`; `allContacts`; label rules) to pass T016. Pure derivation over already-received presence — no new subscription in the common case.
- [ ] T018 [US3] Show the group online count in the group header of `src/views/detail/ChatDetailPage.vue` (the slot that currently renders no presence line for groups), using `useGroupPresence().label`; render nothing when empty.
- [ ] T019 [US3] Show the compact group count on group rows in `src/components/ChatListItem.vue` and group tiles in `src/components/PinnedChatsGrid.vue` (space-appropriate `N online`), consistent with the header.
- [ ] T020 [US3] (Optional, bounded) In `src/composables/useSync.ts` usage, `subscribePresence(openGroupMemberIds)` for the currently-open group only, to catch inbound-only contact edges; never subscribe whole-list group members. Document that strangers still resolve offline (server-gated).
- [ ] T021 [P] [US3] Extend `drive/scenarios/list-status-presence.mjs` (US3 section): all-contact group count vs mixed-group "online contacts" wording vs empty; screenshot header + row.
- [ ] T022 [P] [US3] Extend `e2e/list-status-presence.spec.ts` (US3 case): group header count matches the number of online members.

**Checkpoint**: US3 independently shippable — honest group online counts everywhere.

## Phase 6: User Story 4 — Per-member group dots (P4)

**Goal**: Inside a group, online members' avatars show a proportional dot; typing/recording overrides it; dotted avatars equal the header count.

**Independent test**: Two online contact-members show dots; one starts typing → activity indicator instead; dotted count == header count.

- [ ] T023 [US4] Render `.presence-dot` on group member (sender) avatars in `src/views/detail/ChatDetailPage.vue`, shown for members in `useGroupPresence().onlineIds`; size proportionally to the in-conversation avatar via an `em`/CSS-var tweak (no new colour).
- [ ] T024 [US4] Make `activityFor(member)` (typing/recording) take precedence over the plain dot for that member, mirroring the header activity-override logic.
- [ ] T025 [P] [US4] Extend `drive/scenarios/list-status-presence.mjs` (US4 section): assert online member avatars show dots, a typing member shows activity instead, and dotted count == header count; screenshot. AND extend `e2e/list-status-presence.spec.ts` (US4 case) to assert member-avatar presence-dot DOM matches the header count (Constitution III).

**Checkpoint**: US4 independently shippable — per-member presence visible in-group.

## Phase 7: Polish & Cross-Cutting

- [ ] T026 Run `/speckit-checklist` for zero-knowledge/privacy (Principle I requires it): verify no new wire data, no server group knowledge, presence stays ephemeral, reciprocity honored; record in `specs/1062-list-status-presence/checklists/`.
- [ ] T027 [P] Accessibility/i18n pass: `aria-hidden` on new dots/ticks (matching existing), count strings bidi-safe, contrast via `--ring-*`/success token; verify light + dark + RTL.
- [ ] T028 Full gate: `npm run build` clean, all new vitest green, `npm run test:e2e -- e2e/list-status-presence.spec.ts` green; drive screenshots reviewed for all four slices.
- [ ] T029 Update spec `Status` to `in-review` and regenerate `ROADMAP.md` (`make roadmap`) when opening the feature PR.

---

## Dependencies & order

- **Setup (T001–T002)** → **Foundational (T003–T007)** blocks all stories (shared tick helper/component + `lastTick` maintenance; `useGroupPresence` is created in US3).
- **US1 (T008–T011)** depends only on Foundational — the MVP.
- **US2 (T012–T015)** depends on Foundational (uses `MessageTick` + `.presence-dot`); independent of US1.
- **US3 (T016–T022)** introduces `useGroupPresence`; independent of US1/US2.
- **US4 (T023–T025)** depends on US3 (`useGroupPresence.onlineIds`).
- **Polish (T026–T029)** last.

## Parallel opportunities

- T003 (test) ∥ nothing before it; T004 after T003.
- Within a story, the `[P]` drive/e2e tasks (T010/T011, T015, T021/T022, T025) run parallel to each other once the story's UI task lands.
- US1, US2, and US3 can be built in parallel by different contributors after Foundational; US4 waits on US3.

## Implementation strategy

- **MVP = US1** (list-row ticks): highest-frequency payoff, smallest surface, reuses everything from Foundational.
- Ship incrementally US1 → US2 → US3 → US4; each checkpoint is demoable and testable on its own.
- Total: 29 tasks (Setup 2, Foundational 5, US1 4, US2 4, US3 7, US4 3, Polish 4).
