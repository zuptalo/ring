# Research: Reaction Notifications & Group Reply Escalation (spec 1048)

**Date**: 2026-07-13 · All Technical Context unknowns resolved; no NEEDS CLARIFICATION remain.

## R1. Where inbound reactions flow today, and why the toggles are dead

**Finding**: `receiveIncoming` short-circuits reaction frames at `src/db/queries.ts:5814`
(`if (payload.reaction) await handleReaction(...)`), and `handleReaction` (`queries.ts:705`)
applies the reaction + updates the chat-list preview (`lastKind: 'reaction'`) but never calls
`notifyIncoming`. On the SW side, `buildNote` lumps reactions with poll votes / edits / erases
as "silent side effects" (`src/services/sw-inbox.ts:390-395`). The schema toggles
`notifications.message.reactions` / `notifications.group.reactions` (`schema.ts:517/525`,
default `true`, already in `SYNCED_PREF_KEYS` at `ownsync-keys.ts:19-20`) have zero consumers.

**Decision**: hook the notification dispatch into `handleReaction` (page path) and into the
reaction branch of `buildNote` (SW path); gate by `chat.isGroup ? group.reactions : message.reactions`.

**Alternatives considered**: dispatch at the `queries.ts:5814` call site instead — rejected;
`handleReaction` already holds the resolved message + chat, so the hook is one lookup cheaper
and keeps the reaction logic in one function.

## R2. Detecting "reaction to MY message" (both paths)

**Finding**: `ReactionSignal` carries only `{messageId, emoji, remove, at}`. But
`handleReaction` already does `getMessage(signal.messageId)`; own messages are identified as
`m.outgoing || m.senderId === 'me'` (idiom at `queries.ts:1661`; `newOutgoing` writes
`senderId: 'me'`). The SW can perform the same read-only `get<Message>('messages', id)` — it
already reads the `chats` and `settings` stores via `@/db/idb`.

**Decision**: page and SW both resolve the target message and require it to be own-authored;
an unresolvable target (deleted, or reaction raced ahead of the message) stays a silent
side-effect exactly as today (spec edge case: "no orphan notification, never a crash").

**Alternatives considered**: adding an `authorId` field to `ReactionSignal` — rejected: wire
format change for information the receiver already has locally, and old senders wouldn't send it.

## R3. Detecting "reply to MY message" without a lookup

**Finding**: `ReplyRef` (`src/db/types.ts:268`) carries `senderId` — "the quoted message's
author's Ring user id" — snapshotted by the sender so quotes render even if the original is
gone. So reply-to-me ⇔ `payload.reply?.senderId === selfId`, computable in both paths with no
message lookup, and robust to the quoted message being deleted locally.

**Decision**: use `payload.reply.senderId === selfId` (page: next to `selfMentioned` at
`queries.ts:6012`; SW: next to the mention check at `sw-inbox.ts:426`). "Directly replied-to
author only" (spec edge case) falls out naturally — a reply chain quotes exactly one message.
Self-replies never escalate: inbound frames are never from self, and outgoing messages skip
`receiveIncoming` entirely.

**Alternatives considered**: resolving `reply.id` against the messages store — rejected: extra
read, and breaks when the quoted message was deleted (the snapshot exists precisely for that).

## R4. Escalation machinery: reuse `isMention`, don't extend the policy

**Finding**: `notificationOwner` (`src/services/notify-policy.ts`) is the deliberately pure,
shared spec-2010 predicate; `pref.isMention` already means "escalates past the per-chat
silencers — mute, in-app-off, content=none, web-push-off, settle window — but not the
structural gates". That is *exactly* the semantics spec 1048 FR-008 assigns to replies-to-you
("no more, no less"), and it is already gated by the chat's `notifyMentions` pref at both call
sites (FR-009).

**Decision**: `notify-policy.ts` stays byte-identical. Callers widen what feeds the flag:
`escalate = selfMentioned || selfRepliedTo`. Display strings differentiate ("Alice replied to
you" vs "Alice mentioned you"); when a message both replies-to and mentions the user, mention
wording wins and exactly one notification shows (FR-012 — trivially true since it is one
message → one note). `chat.unreadMentions` increments for either trigger (FR-011); the field
name stays (it is a UI counter, not a wire format).

**Alternatives considered**: a separate `isReply` input on `NotifyInput` with its own branch
logic — rejected: it would duplicate every silencer exception and reintroduce the two-sides-
drift problem notify-policy exists to kill.

## R5. Push-health invariant (FR-013) — existing machinery suffices

**Finding**: reaction frames ALREADY wake the SW today and end silently at the buildNote level,
yet the app is 3-strikes-safe because the wake pipeline (specs 1034/2016/2017/2023) guarantees a
visible ending independent of note content: re-assert the freshest coalesced per-chat summary
silently (`renotify:false`+`silent`), else the quiet generic via `showQuietUnlessVisible`
(`sw.ts:304-374`), with silence licensed only on Chromium with a focused visible window
(`mayEndWakeSilently`). The `silenced` (badge-only) and `{note:null}` outcomes are established,
iOS-tolerated shapes.

**Decision**: suppressed reaction/reply outcomes return the same shapes buildNote returns today;
no new fallback code. The feature strictly *increases* the share of wakes that end with rich
visible content. Tests assert the suppressed-path return shapes so a refactor can't silently
create a new outcome class.

**Alternatives considered**: none viable — server-side filtering is impossible (zero-knowledge,
FR-014), and any client-side "swallow" would be exactly the silent wake FR-013 forbids.

## R6. The dedicated reaction sound (clarification #2)

**Finding**: tones are synthesized on-device (`src/services/sound.ts`, `playTone`); the
settings pattern is a link page with one choice over `TONES` (`schema.ts:146` — already
includes `{value:'none'}`), cf. `notifications-message-sound` (`schema.ts:566`). In-app sound
plays via `inAppSound()` (`notify.ts:353`) using the cached `messageSound`. SW `showNotification`
cannot play custom tones; it only has the binary `silent` option.

**Decision**: one global key `notifications.reactions.sound`, choice over `TONES`, default
**`pop`** (subtle + distinct from the message default `note`, per the spec assumption "quiet/
subtle, distinct from the message tone"). Page path: reaction dispatch plays this tone instead
of `messageSound` (a `none` value ⇒ no tone; banner still shows). SW path: `none` ⇒
`silent: true` on the note; any tone ⇒ platform default sound. Add the key to
`SYNCED_PREF_KEYS` (its siblings are all synced) and to the notify.ts prefs cache
(`NotifyPrefs` + `loadPrefs`).

**Alternatives considered**: per-surface keys (1:1 vs group reaction sound) — rejected: the
clarification asked for one dedicated preference; the gating toggles are already per-surface.
Reusing `notifications.message.sound` — rejected by clarification.

## R7. Notification content, masking, and coalescing

**Finding**: masking is centralized: page `notify.ts:445-479` (content/showPreview →
generic body "New message", generic title "Ring"; mentions keep naming the mentioner), SW
`sw-inbox.ts:430-467` (same rules; group bodies prefix the sender; tag `ring:<chatId>` drives
`aggregate` + the spec-2017 cumulative summary). `notifyPreview` + `previewText`
(`queries.ts:2096`) provide short message snapshots (previewText is already used for reaction
chat-list lines).

**Decision**:
- Full content: title = sender (1:1) / group name (group); body = `Alice reacted ❤️ to: <previewText(target)>`
  (SW group bodies keep the existing group title convention; the reactor is named in the body).
- `content='generic'` or global preview off: fully generic (reaction notes do NOT name the
  reactor — they never escalate, FR-002/edge case), falling into the existing
  "Ring / New message" shape.
- Escalated reply under masked content: `Alice replied to you` (mention parity, FR-010).
- Tag stays `ring:<chatId>` so reactions/replies coalesce into the chat's one updating
  notification (FR-003); no new tag namespace.

**Alternatives considered**: a distinct `ring:reaction:<chatId>` tag for a separate stack —
rejected by spec (FR-003: never a separate per-reaction stack).

## R8. Test surface

**Finding**: rich existing suites to extend: `notify-policy.test.ts` (pure predicate),
`sw-inbox.test.ts` + focused siblings (`sw-inbox.badge/hidden/preview/reassert.test.ts`),
`notify.hidden.test.ts` pattern for page-path tests, `e2e/mentions.spec.ts` (spec 1020
escalation flows, drives via `window.__ringTest`). Vitest coverage floors are a ratchet
(Principle III).

**Decision** (test-first ordering for tasks.md):
- Unit (red first): sw-inbox reaction-note cases (mine/not-mine/remove/toggle-off/muted ⇒
  `silenced` shape/hidden/generic-content), sw-inbox reply-escalation cases, notify.ts
  reaction dispatch (tone choice, active-chat suppress, no unread change), queries-side
  `selfRepliedTo` + `unreadMentions` increment.
- e2e: extend `mentions.spec.ts` (reply in muted group notifies; `notifyMentions` off ⇒
  ordinary), new `reaction-notify.spec.ts` (author-only, toggle off ⇒ nothing, removal
  silent, burst coalesces — assert via the existing notification-capture helpers).
- notify-policy.test.ts needs no new cases (predicate unchanged) but gets a comment-level
  note that replies feed `isMention`.
