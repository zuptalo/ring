# Research & Decisions: @mentions in group chats

Grounded in the actual codebase shapes (verified file/line references in parentheses).

## D1 — Group roles don't exist; v1 "admin" = group owner (`createdBy`)

- **Finding**: Ring groups are **all-member parity** — `createGroup` (queries.ts ~1117) stores
  `participantIds` with no `admin`/`owner`/`role` field on `Chat`, `GroupCard`, or `GroupMember`;
  add/remove are callable by any member. The spec's assumption that roles exist is **wrong**.
- **Decision**: For v1, the group **owner = its creator**. Stamp `createdBy: self` on the group
  `Chat` at creation and carry it in the group `create` card so every member learns the owner.
  `@everyone` is offered only to the owner and re-validated against `createdBy` on receive.
- **Rationale**: Smallest change that satisfies the locked "admin-only @everyone" decision without
  building a roles/permissions system (out of scope). A full admin model can supersede `createdBy`
  later without changing the payload.
- **Alternatives rejected**: (a) anyone can `@everyone` — contradicts the locked decision and
  invites spam; (b) full roles system — far larger than this spec.

## D2 — Mentions live in `MessagePayload` (E2EE), keyed by member id

- **Finding**: the sealed payload is `MessagePayload` (crypto/message.ts ~208), `JSON.stringify`d in
  `sealMessage` and parsed in `openMessage`/`openMessagePreview`. It already carries optional
  structured fields (reply, poll, mediaRef…).
- **Decision**: add `mentions?: string[]` (mentioned member ids) and `mentionsEveryone?: boolean`.
  Store the same two fields on the local `Message` (db/types.ts) for rendering + seen tracking.
  Mentions reference **stable member ids**; the chip renders the member's CURRENT name (FR-009),
  so a rename/`@`-text never desyncs.
- **Rationale**: id-keyed mentions are rename-proof and exactly what the recipient needs to decide
  "am I mentioned?" locally. Nothing new crosses the wire in cleartext (server only sees ciphertext).
- **ZK note**: the push tickle is unchanged + content-free; the server can't see the mention.

## D3 — Escalation is one new boolean in the SHARED notify policy

- **Finding**: `notificationOwner(i: NotifyInput): 'page-banner'|'sw-notification'|'suppress'`
  (notify-policy.ts ~61) is consumed by BOTH `notify.ts` (foreground) and `sw-inbox.ts` (SW), so
  they can't drift. Its first gate is `if (pref.muted) return 'suppress'`; later
  `if (pref.content==='none') return 'suppress'`.
- **Decision**: add `isMention: boolean` to `NotifyInput.pref`. When `isMention` is true (computed
  by each caller = "self is in payload.mentions, OR a *validated* mentionsEveryone, AND
  chat.notifyMentions !== false"):
  - the `muted` gate does NOT suppress (a mention pierces mute);
  - `content:'none'`/`'generic'` is treated as at least `'generic'`/`'full'` enough to name the
    sender ("Alice mentioned you");
  - the global master (`p.showMessages` in notify.ts) and OS DND are checked BEFORE the policy and
    are NOT overridden;
  - the per-chat `notifyMentions=false` short-circuits `isMention` to false (no escalation).
- **Rationale**: one boolean in the single shared predicate keeps foreground + SW identical (the
  exact reason this predicate exists). Callers compute `isMention`; the policy encodes the override.
- **Alternatives rejected**: separate escalation branches in notify.ts and sw-inbox.ts — guaranteed
  to drift (the spec-2010 class of bug).

## D4 — Per-chat `notifyMentions` rides the existing per-chat prefs

- **Finding**: `getChatNotifyPrefs`/`setChatNotifyPrefs` read/write the `Chat` record's
  `notifyWebPush`/`notifyInApp`/`notifyContent` fields (used by ContactDetailPage's per-chat
  notification settings); these sync via own-data sync like other chat fields.
- **Decision**: add `notifyMentions?: boolean` to `Chat` + `ChatNotifyPrefs` (default true when
  unset). Surface a "Notify for mentions even when muted" toggle in the chat/group notification
  settings. Group-only (1:1 has no mentions).

## D5 — "Seen" semantics for the unread-mention marker

- **Finding**: `chat.unread` increments on receive unless `isChatActive` (queries.ts ~4187) and is
  zeroed by `markChatRead`.
- **Decision**: add `unreadMentions?: number`, incremented on receive when the message mentions
  self (or validated `@everyone`) and the chat isn't active; cleared in the SAME `markChatRead`
  block as `unread`, and on message delete / leaving the group (FR-020). v1 treats "open the chat"
  as seen-all (cleared with `unread`); per-message jump advances to the next unread mention.
- **Rationale**: reuses the proven read/seen path; avoids a separate per-message seen ledger in v1.
  (Per-message mention seen-tracking, where opening doesn't clear all, is a possible follow-up.)

## D6 — Rendering: a new segment in the existing `bodyParts` splitter

- **Finding**: `bodyParts(body)` (ChatDetailPage.vue ~1490) already splits text into
  link/emoji/plain segments via `linkParts` + `segmentEmoji`.
- **Decision**: add a `mention?: { id: string; name: string }` segment. The bubble renders a
  mention chip (tappable → contact page) and emphasizes a mention of self. The composer inserts a
  recognizable token on autocomplete-select and `send()` resolves tokens → `mentions: string[]`
  by id. (Exact token/encoding is an implementation detail for tasks; ids are the source of truth.)

## D7 — SW upgrade path

- **Finding**: `noteForPayload` (sw-inbox.ts ~141) builds the SW notification title/body from the
  decrypted payload, after mute/hidden/content checks; the SW shows a generic note when it can't
  decrypt and a rich one when it can.
- **Decision**: in `noteForPayload`, compute `isMention` and, when true + `notifyMentions`, bypass
  the mute/content suppression and set the body to name the mentioner ("Alice mentioned you[: …]").
  Generic-until-decrypted is unchanged; once decrypted the note reflects the mention.

## Open follow-ups (explicitly out of v1)

- Per-message mention seen-tracking (open-doesn't-clear-all).
- A full group roles/permissions model (supersedes `createdBy`).
- `@here`, segment mentions, anti-spam beyond the owner gate, cross-chat "my mentions" view.
