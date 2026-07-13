# Tasks: Reaction Notifications & Group Reply Escalation

**Input**: Design documents from `/specs/1048-notify-reactions-messages/`

**Prerequisites**: plan.md, spec.md (clarified), research.md, data-model.md, contracts/notification-decisions.md, quickstart.md

**Tests**: INCLUDED and ordered first — TDD is constitutionally mandated (Principle III): failing tests land before the implementation that satisfies them. New user-facing behavior ⇒ e2e coverage required.

**Organization**: grouped by user story; US1 (reactions) is the MVP slice, US2 (reply escalation) is fully independent of US1, US3 (suppression + push health) hardens US1's off-switches.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup (settings surface)

**Purpose**: the one new user-facing control, so every later task can read it

- [ ] T001 Add the `notifications.reactions.sound` choice (options `TONES`, default `'pop'`) as a new link page + entry beside the existing message/group Sound links in src/settings/schema.ts, and extend src/settings/schema.test.ts to cover the key and default
- [ ] T002 Add `'notifications.reactions.sound'` to `SYNCED_PREF_KEYS` in src/services/ownsync-keys.ts (siblings `notifications.message.reactions` / `notifications.group.reactions` are already listed)

---

## Phase 2: Foundational (shared type extensions)

**Purpose**: interface changes both stories build on; typecheck-only, no behavior yet

- [ ] T003 Extend `IncomingNotice` with optional `reaction?: boolean` and `replied?: boolean` fields (documented per data-model.md) in src/services/notify.ts, and add `reactionSound` to the `NotifyPrefs` cache + `loadPrefs`
- [ ] T004 [P] Extend `SwNote` with optional `silent?: boolean` in src/services/sw-inbox.ts and thread it into the `showNotification` options at the note-show call sites in src/sw.ts (default unchanged when absent)

**Checkpoint**: `npm run build` passes; zero behavior change

---

## Phase 3: User Story 1 - Know when someone reacts to your message (Priority: P1) 🎯 MVP

**Goal**: an author gets a coalesced, masking-aware, never-escalating notification when someone reacts to their message, in 1:1 and groups, on both delivery paths

**Independent Test**: two accounts; B reacts to A's message → A sees banner (app open) / OS note (app closed) naming B + emoji; a third member's reaction to someone else's message shows nothing

### Tests for User Story 1 (write first, MUST fail) ⚠️

- [ ] T005 [P] [US1] New unit suite src/services/sw-inbox.reactions.test.ts asserting contract Table 1 (specs/1048-notify-reactions-messages/contracts/notification-decisions.md): note built only for own-authored target + toggle on; correct title/body/tag `ring:<chatId>`; `silent` iff tone `'none'`; suppressed rows return today's exact shapes (`{note:null, wasMessage:false}` / `silenced`); remove/not-mine/self/missing-target silent; group vs 1:1 gated by the right toggle; generic content / preview-off fully generic; hidden chat unchanged
- [ ] T006 [P] [US1] New unit suite src/services/notify.reactions.test.ts for the page path: reaction notice plays `notifications.reactions.sound` (not `messageSound`), `'none'` tone ⇒ banner without tone, active-chat ⇒ suppress + tone only, muted/settle ⇒ suppress (no escalation), masked content ⇒ generic body, and `chat.unread`/`unreadMentions` untouched
- [ ] T007 [P] [US1] New e2e spec e2e/reaction-notify.spec.ts (live-page path, per quickstart.md): B reacts to A's message ⇒ A's banner shows "reacted ❤️"; A viewing the chat ⇒ no banner; reaction to C's message ⇒ nothing for A; reaction removal ⇒ nothing; burst of reactions ⇒ single coalesced banner (dedup by target)

### Implementation for User Story 1

- [ ] T008 [US1] Dispatch the reaction notification from `handleReaction` in src/db/queries.ts: on add (not remove), target own-authored (`m.outgoing || m.senderId === 'me'`), reactor ≠ self, gated by `chat.isGroup ? 'notifications.group.reactions' : 'notifications.message.reactions'` → `notifyIncoming({kind:'message', reaction:true, chatId, msgId, name, body: "<first-name> reacted <emoji> to: <previewText(m)>", pushWoken})`; never touch unread counters
- [ ] T009 [US1] Handle `reaction: true` notices in `notifyIncoming` in src/services/notify.ts: always `isMention:false`, reaction tone via `inAppSound` variant, masked content ⇒ fully generic body (reactor not named), otherwise existing banner flow (coalescing by target URL already applies)
- [ ] T010 [US1] Build reaction notes in `buildNote` in src/services/sw-inbox.ts: replace the silent lump for `payload.reaction` with the Table 1 decision (read-only `get<Message>('messages', id)`, self id via existing session helper, toggles + per-chat prefs + hidden + mute exactly as the contract table; suppressed rows return today's shapes; tag `ring:<chatId>`; `silent` from the tone setting); poll votes/edits/erase/rekey/ttl stay silent side effects

**Checkpoint**: T005–T007 green; `npm run build` + full `npx vitest run` green — MVP demoable via quickstart drive scenario

---

## Phase 4: User Story 2 - A reply to you cuts through a muted group (Priority: P2)

**Goal**: a direct reply to one of YOUR messages in a group escalates exactly like an @mention (same pref, same silencer set), names the replier under masked content, and counts in the unread-mentions indicator

**Independent Test**: A mutes a group; B replies to A's message ⇒ A is notified + `@` indicator; B replies to C's message ⇒ A stays silent; `notifyMentions` off ⇒ ordinary message

### Tests for User Story 2 (write first, MUST fail) ⚠️

- [ ] T011 [P] [US2] Extend src/services/sw-inbox.test.ts (mention/escalation block) with contract Table 2 cases: `payload.reply.senderId === selfId` in a muted group ⇒ note despite mute with "replied to you" wording under masked content; `notifyMentions` off ⇒ ordinary handling; reply to someone else / 1:1 reply ⇒ no escalation; reply that also mentions me ⇒ ONE note with mention wording
- [ ] T012 [P] [US2] New unit coverage for the page path (extend src/services/notify.reactions.test.ts or a sibling notify.replies.test.ts in src/services/): `replied: true` notice escalates past mute/in-app-off/content-none/settle exactly like `mention: true`, body "«name» replied to you" when masked, and both flags together render mention wording once
- [ ] T013 [P] [US2] Extend e2e/mentions.spec.ts: reply-to-A's-message in a muted group surfaces A's banner and bumps the chat's unread-mentions indicator, cleared on read; with the chat's mentions pref off the reply is suppressed like any muted message

### Implementation for User Story 2

- [ ] T014 [US2] Compute `selfRepliedTo` (`isGroupMsg && payload.reply?.senderId === selfId`) beside `selfMentioned` in the receive path of src/db/queries.ts; feed `unreadMentions` increment and pass `replied: selfRepliedTo` + existing `mention`/`mentionName` through `notifyIncoming`
- [ ] T015 [US2] Escalate `replied` notices in src/services/notify.ts: fold into the existing `isMention` computation (gated by `chatPrefs.mentions`), wording "«mentionName» replied to you" when masked with mention wording taking precedence when both flags set
- [ ] T016 [US2] Escalate replies in `buildNote` in src/services/sw-inbox.ts: widen the `selfMentioned` check with `payload.reply?.senderId === selfId` (same `chat?.notifyMentions !== false` gate, hidden still wins), body "«sender» replied to you[: preview]" with mention wording when both apply

**Checkpoint**: T011–T013 green; US1 suites still green

---

## Phase 5: User Story 3 - Turning it off really turns it off, without breaking push (Priority: P3)

**Goal**: the two reaction toggles are independently effective, every suppressed delivery still ends the wake visibly (FR-013), and no unread/badge state changes leak in

**Independent Test**: toggles off ⇒ zero reaction notifications while deliveries continue; suppressed outcomes are byte-identical to today's shapes so the spec-2016/2017/2023 fallback applies

### Tests for User Story 3 (write first where not already red) ⚠️

- [ ] T017 [P] [US3] Extend src/services/sw-inbox.reactions.test.ts with toggle-independence cases (1:1 off + group on, and inverse) and an explicit shape-equality assertion that every suppressed reaction outcome deep-equals the pre-1048 outcomes for the same frames (guards FR-013: no new outcome class for sw.ts's visible-wake fallback)
- [ ] T018 [P] [US3] Extend src/services/sw-inbox.badge.test.ts asserting reaction frames keep `wasMessage: false` in every branch (shown, suppressed, silenced) so badge counting is unchanged
- [ ] T019 [US3] Extend e2e/reaction-notify.spec.ts: toggle `notifications.message.reactions` off via settings ⇒ subsequent reactions show nothing while the chat-list "reacted" preview still updates; toggle back on ⇒ notifications resume (SC-005 dead-controls check)

### Implementation for User Story 3

- [ ] T020 [US3] Fix any gaps T017–T019 expose in src/services/sw-inbox.ts / src/services/notify.ts / src/db/queries.ts (expected: none — the US1 implementation must already satisfy the contract; this task exists to make red→green explicit if it isn't)

**Checkpoint**: all three stories green and independently demonstrable

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T021 [P] Note in src/services/notify-policy.ts's `isMention` doc comment that replies-to-you (spec 1048) feed the same flag — no logic change (predicate stays byte-identical; its test file untouched)
- [ ] T022 [P] Run the quickstart.md drive scenario against `make start` (new throwaway scenario under drive/scenarios/, screenshots to .tmp/drive/) and fix anything it exposes
- [ ] T023 Full gates: `npm run build`, `npx vitest run` (coverage floors), `npm run test:e2e` (needs `make db-up`), and `cd server && go build ./... && go vet ./... && go test ./...` (expected no-op — proves no server surface was touched)
- [ ] T024 Flip spec Status to `in-progress`→`in-review` as work proceeds and run `make roadmap` (CI staleness guard)

---

## Dependencies & Execution Order

- **Setup (P1)**: T001–T002 first (T001 → T002 touch different files, may run [P] in practice)
- **Foundational (P2)**: T003–T004 after setup; **blocks all stories** (types must exist for tests to compile)
- **US1 (P3)**: T005–T007 (parallel, different files) → T008–T010 (T009 and T010 parallel after T008's notice shape exists)
- **US2 (P4)**: independent of US1 code-wise but shares files — run after US1 to avoid same-file conflicts; T011–T013 (parallel) → T014 → T015–T016 (parallel)
- **US3 (P5)**: after US1 (it hardens US1 behavior); T017–T019 (parallel) → T020
- **Polish (P6)**: T021–T022 parallel; T023 after everything; T024 bookkeeping

### Parallel opportunities

- All test-first tasks within a story ([P] marked) — different files
- T009 ‖ T010 (page vs SW), T015 ‖ T016 (same split)
- T021 ‖ T022 in polish

---

## Implementation Strategy

MVP = Phases 1–3 (US1): reaction notifications shipped-quality behind the existing toggles.
Then US2 (independent feature), then US3 (hardening, mostly test-enforced). Stop at any
checkpoint to validate; each story is demoable through the quickstart drive scenario.
Commit after each task or logical group (`test(notify): …` red commits are fine).
