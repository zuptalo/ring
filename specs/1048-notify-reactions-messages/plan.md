# Implementation Plan: Reaction Notifications & Group Reply Escalation

**Branch**: `feat/1048-notify-reactions-messages` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/1048-notify-reactions-messages/spec.md`

## Summary

Make the two existing-but-dead reaction toggles real (notify a message's author when
someone reacts, in 1:1 and groups) and escalate direct replies-to-you in groups past
mute exactly like @mentions (spec 1020). Client-only: reactions and reply references
already travel in sealed payloads, so **nothing new crosses the wire** — both features
are receiving-device notification decisions layered onto the existing two-path
notification architecture (live page `queries.ts → notify.ts` with the spec-2010
one-owner policy in `notify-policy.ts`, and the closed-app SW path `sw-inbox.ts
buildNote`). Suppressed deliveries inherit the established spec-2016/2017/2023
visible-outcome machinery unchanged, so no new class of silent wakes is possible.
One new setting (per clarification): a dedicated reaction alert tone with a silent
option, `notifications.reactions.sound`.

## Technical Context

**Language/Version**: TypeScript 5 / Vue 3 `<script setup>` + Ionic 8 (client only — no Go/server change)

**Primary Dependencies**: existing notification stack — `src/services/notify.ts` (in-app banners),
`src/services/notify-policy.ts` (pure one-owner predicate, spec 2010), `src/services/sw-inbox.ts`
(SW note building), `src/sw.ts` (push wake + quiet-generic fallback, specs 1034/2016/2017/2023),
`src/services/sound.ts` (synthesized tones), `src/settings/schema.ts` (declarative settings),
`src/services/ownsync-keys.ts` (synced-prefs allowlist)

**Storage**: IndexedDB via `src/db/idb.ts` (no new object stores; no `DB_VERSION` bump — one new
row in the existing `settings` store)

**Testing**: vitest unit tests colocated (`*.test.ts`, coverage floors are a ratchet);
Playwright e2e under `e2e/` (extend `e2e/mentions.spec.ts`, new reaction-notification spec)

**Target Platform**: installable PWA (iOS WebKit is the binding constraint: webpushd's
cumulative 3-strike silent-push counter, spec 2022/1034)

**Project Type**: web app (client half of the Ring monorepo)

**Performance Goals**: notification decision adds ≤1 IndexedDB `get` per inbound reaction
(the target-message lookup `handleReaction` already performs); no measurable latency change
on the receive path (SC-001: visible within 5 s of delivery)

**Constraints**: zero-knowledge (server cannot filter reaction pushes — FR-014); every push
wake must end visibly (FR-013); `messaging.ts` stays crypto-only (all changes live in
`queries.ts`/services, dependency direction preserved); no unread-count changes (clarified)

**Scale/Scope**: ~6 source files touched, ~4 unit-test files, 2 e2e specs; no server, no
migrations, no new components (settings UI is a data edit per Principle X/XI)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Zero-Knowledge Boundary | ✅ PASS | No wire change at all. Reactions (`payload.reaction`) and reply refs (`payload.reply`) are already inside sealed envelopes; all new decisions run on the receiving device. Spec carries a Zero-Knowledge Impact section (FR-014). |
| II. Spec-Driven Development | ✅ PASS | Spec 1048, clarified 2026-07-13; this plan; tasks/analyze/taskstoissues to follow in order. |
| III. Test-Driven Development | ✅ PASS (plan) | tasks.md must order failing unit tests (notify.ts dispatch, sw-inbox buildNote, queries escalation) and e2e before implementation. No crypto/auth/store/HTTP-handler change; user-facing behavior ⇒ e2e required. |
| IV. Crypto Discipline | ✅ N/A | No crypto change. `messaging.ts` untouched; `previewPacket` (SW read-only decrypt) reused as-is. |
| V. Offline-First Data Integrity | ✅ PASS | No store/schema change; one new `settings` row through the existing `idb` wrapper + change bus. |
| VI. Stateless Server | ✅ N/A | Server untouched. |
| VII. Quality Gates | ✅ PASS (plan) | `npm run build`, vitest + floors, e2e where behavior changed. Release-note subject: plain-language (e.g. "feat(chats): get notified when someone reacts to your message"). |
| VIII. Traceable Delivery | ✅ PASS | taskstoissues + `Closes #N` on the PR. |
| IX. Privacy & Data Minimization | ✅ PASS | Content-masking parity: reaction/reply notifications reveal no more than message notifications at the same preference level (SC-006). |
| X/XI. A11y & Ionic-First | ✅ PASS | New setting is a data edit to `src/settings/schema.ts` (choice page identical to the existing message/group tone pages); no new components. |

`/speckit-checklist` is **not required**: no Principle I or IV surface is touched (nothing
new crosses the wire, no crypto change). The ZK Impact statement lives in the spec regardless.

**Post-design re-check (after Phase 1)**: still clean — the design introduced no new moving
parts beyond the one settings key; Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/1048-notify-reactions-messages/
├── spec.md              # Feature spec (clarified 2026-07-13)
├── plan.md              # This file
├── research.md          # Phase 0: decisions + codebase findings
├── data-model.md        # Phase 1: touched types/keys (no new stores)
├── quickstart.md        # Phase 1: how to run/verify this feature in dev
├── contracts/
│   └── notification-decisions.md  # Phase 1: decision tables both paths must satisfy
├── checklists/requirements.md     # From /speckit-specify
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── settings/schema.ts            # + 'Reaction sound' link page (choice, TONES, default 'pop')
├── services/
│   ├── ownsync-keys.ts           # + 'notifications.reactions.sound' in SYNCED_PREF_KEYS
│   ├── notify.ts                 # IncomingNotice: reaction/reply variants; reaction tone; masked bodies
│   ├── notify-policy.ts          # UNCHANGED (isMention flag already models "escalates"; replies reuse it)
│   ├── sw-inbox.ts               # reaction branch builds a note; reply joins the mention escalation
│   └── sw-drain.ts               # inherits via shared buildNote (drain already defers reaction frames)
├── sw.ts                         # thread SwNote.silent → showNotification options (reaction tone 'none')
└── db/queries.ts                 # handleReaction → notify dispatch; selfReplied escalation + unreadMentions

e2e/
├── mentions.spec.ts              # extend: reply-to-you escalates a muted group; notifyMentions=off downgrade
└── reaction-notify.spec.ts       # new: reaction notifies author only; toggles; coalescing; removal silent

src/services/*.test.ts            # notify.reactions.test.ts, sw-inbox.reactions.test.ts,
                                  # sw-inbox reply cases, queries-side escalation unit coverage
```

**Structure Decision**: single-project client change inside the existing monorepo layout;
no server directory involvement.

## Architecture decisions (what implementation must follow)

Full rationale in [research.md](./research.md); the binding decisions:

1. **Reply-to-you detection is lookup-free**: `payload.reply?.senderId === selfId`
   (`ReplyRef.senderId` is the quoted message's author, `src/db/types.ts:268`). Works
   identically on the page (`queries.ts:6012` area) and in the SW (`sw-inbox.ts:426` area),
   even when the quoted message no longer exists locally. Self-replies are excluded because
   inbound frames are never from self (and outgoing skips the path entirely).
2. **Reaction "is mine" detection reuses the existing lookup**: `handleReaction`
   (`queries.ts:705`) already `getMessage(signal.messageId)`; mine ⇔ `m.outgoing || m.senderId === 'me'`
   (the codebase's own-message idiom, `queries.ts:1661`). The SW does the same read-only
   `get<Message>('messages', id)` — it already reads chats/settings stores. Unresolvable
   target (deleted / not-yet-arrived) ⇒ stays today's silent side-effect (edge case per spec).
3. **Escalation reuses `isMention` wholesale**: `notificationOwner` (`notify-policy.ts`)
   is NOT modified. Callers compute `isMention = selfMentioned || selfRepliedTo`, both gated
   by the chat's existing `notifyMentions` pref. Only the display strings differ
   ("mentioned you" vs "replied to you"); a message that is both mentions-and-reply renders
   the mention wording (one notification, FR-012).
4. **Reactions never escalate**: the reaction dispatch always passes `isMention: false`
   and flows through `notificationOwner` like a plain message, so mute / in-app-off /
   content-none / settle-window / hidden all suppress it (FR-005). `wasMessage` stays
   `false` on the SW side and unread counts are untouched (clarified: notification only).
5. **Push health needs NO new machinery**: today a reaction-only wake already ends via the
   spec-2016/2017/2023 pattern (re-assert coalesced summary silently, else quiet generic via
   `showQuietUnlessVisible`/`guardedPush`, `sw.ts:304-374`). Suppressed reaction/reply notes
   return the same shapes buildNote returns today (`{note:null, wasMessage:false}` or
   `silenced`), inheriting that guarantee (FR-013). The feature only ADDS visible notes.
6. **One new setting**: `notifications.reactions.sound` (choice over the existing `TONES`
   list which already includes `none`; default **`pop`** — subtle, distinct from the message
   default `note`, satisfying the clarification). Rendered as a link page identical to
   `notifications-message-sound` (`schema.ts:566`), added to `SYNCED_PREF_KEYS`. On the SW
   path (no Web Audio), tone `none` maps to `silent: true` on `showNotification`; any other
   tone keeps the OS default sound — the closest the platform allows.
7. **Coalescing is free**: reaction/reply notes use the chat's existing `ring:<chatId>` tag,
   so `aggregate` + the spec-2017 cumulative summary collapse bursts into the one updating
   per-chat notification (FR-003, SC-004).
8. **Chat-list surfacing already exists** (`lastKind: 'reaction'`, `handleReaction`) and is
   not changed; this feature adds only the alerting layer.

## Complexity Tracking

> No constitution violations — table intentionally empty.
