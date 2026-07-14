# Data Model: Reaction Notifications & Group Reply Escalation (spec 1048)

No new object stores, no `DB_VERSION` bump, no wire-format change. This feature reads
existing sealed payload fields and adds one settings row plus small extensions to two
in-memory interfaces.

## Wire / sealed payload (UNCHANGED — read-only consumers added)

| Field | Where | Used by 1048 as |
|---|---|---|
| `payload.reaction: ReactionSignal` `{messageId, emoji, remove, at}` | sealed `MessagePayload`, kind `'reaction'` | trigger for the reaction notification decision (add only; `remove` stays silent) |
| `payload.reply: ReplyRef` `{id, senderId, preview, …}` | sealed `MessagePayload` on ordinary messages | `reply.senderId === selfId` ⇒ reply-to-me escalation (groups only) |
| `payload.mentions` / `mentionsEveryone` | sealed | unchanged; mention wording wins when combined with a reply |

## Settings (existing `settings` store, existing sync mechanism)

| Key | Type | Default | Status |
|---|---|---|---|
| `notifications.message.reactions` | boolean | `true` | EXISTS (dead) → becomes the 1:1 reaction gate |
| `notifications.group.reactions` | boolean | `true` | EXISTS (dead) → becomes the group reaction gate |
| `notifications.reactions.sound` | choice over `TONES` (incl. `none`) | `'pop'` | **NEW** — reaction alert tone; add to `SYNCED_PREF_KEYS` and the `notify.ts` prefs cache |

Per-chat inputs (unchanged, already persisted on `Chat`): `mutedUntil`, `notifyWebPush`,
`notifyInApp`, `notifyContent`, `notifyMentions` (now also gates reply escalation),
`unreadMentions` (now also incremented by replies-to-you; cleared on read as today).

## In-memory interface extensions (not persisted)

### `IncomingNotice` (`src/services/notify.ts:86`)

```ts
// NEW optional fields:
reaction?: boolean;   // this notice is a reaction alert → use the reaction tone,
                      // never escalate, mask to fully-generic under restricted content
replied?: boolean;    // this message directly replies to one of my messages →
                      // feeds the mention-escalation path with "replied to you" wording
```

`mention`/`mentionName` keep their exact meaning; when `replied` is set the caller reuses
`mentionName` for the replier's display name (one naming field, two wordings).

### `SwNote` (`src/services/sw-inbox.ts`)

```ts
// NEW optional field:
silent?: boolean;     // reaction notes when notifications.reactions.sound === 'none'
                      // → threaded to showNotification({ silent: true }) in sw.ts
```

`aggregate` and the spec-2017 `ShownSummary` treat reaction/reply notes identically to
message notes (same `ring:<chatId>` tag) — no shape change there.

## Validation rules (enforced in code, unit-tested)

1. Reaction notifies only when ALL hold: `!signal.remove` ∧ target message resolves ∧
   target is own-authored (`m.outgoing || m.senderId === 'me'`) ∧ reactor ≠ self ∧
   surface toggle on (`isGroup ? group.reactions : message.reactions`) ∧ owner-policy
   result is not `suppress` (mute/hidden/content/settle all suppress; never escalates).
2. Reply escalates only when ALL hold: group chat ∧ `payload.reply?.senderId === selfId` ∧
   `chat.notifyMentions !== false`. Escalation semantics = mention semantics exactly
   (`isMention` input of `notificationOwner`; predicate unchanged).
3. Unread invariants: reactions never touch `chat.unread`, `chat.unreadMentions`, or the
   app badge (`wasMessage: false` on the SW side). Replies-to-you increment
   `chat.unreadMentions` (not `unread` beyond the normal message increment).
4. Suppressed SW outcomes reuse today's shapes — `{note:null, wasMessage:false}` or
   `silenced: true` — so the spec-2016/2017/2023 visible-wake fallback applies unchanged.

## State transitions

None. No entity changes state; the feature is a pure notification-decision layer.
