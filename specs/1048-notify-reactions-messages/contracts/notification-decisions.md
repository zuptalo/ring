# Contract: Notification decisions for reactions & replies (spec 1048)

This is the behavioral contract BOTH delivery paths (live page `notify.ts` + service worker
`sw-inbox.ts`) must satisfy identically, extending the spec-2010 one-owner model. Unit tests
on each side assert these tables; drift between the sides is a defect.

Inputs: `T` = surface toggle (`message.reactions` / `group.reactions`), `M` = chat muted,
`H` = hidden (locked), `C` = per-chat content (`full`/`generic`/`none`), `P` = global
showPreview, `W` = per-chat webPush, `A` = viewing this chat foregrounded,
`NM` = chat `notifyMentions` pref, `S` = post-unlock settle window active (not push-woken).

## Table 1 — Inbound reaction (add) to MY message, reactor ≠ self

| Condition | Outcome (app open) | Outcome (app closed / SW) |
|---|---|---|
| `T` off | nothing (silent side-effect, as today) | `{note:null, wasMessage:false}` → existing visible-wake fallback |
| `H` | traceless per hidden rules (no reaction surface at all) | today's hidden handling, nothing reaction-specific |
| `M` (never escalates) | suppress | `silenced` badge-only shape → existing fallback |
| `A` (viewing the chat) | suppress + reaction tone only | n/a (app open) |
| `S` | suppress (damped with the burst) | n/a (settle is a page concept) |
| `C='none'` or `W` off (closed) | suppress / badge-only | `silenced` |
| `C='full'` ∧ `P` | banner: title sender/group, body `«Alice reacted ❤️ to: <preview>»`, reaction tone | note: same text, tag `ring:<chatId>`, `silent` iff tone `none` |
| `C='generic'` or `!P` | fully generic (existing "Ring / New message" shape — reactor NOT named) | same |
| target message missing / `remove:true` / not my message / reactor = self | nothing, all paths | `{note:null, wasMessage:false}` |

Invariants: never escalates; never changes `chat.unread`/`unreadMentions`/badge; coalesces
under the chat's existing tag (burst of N ⇒ one updating notification, cumulative count).

## Table 2 — Group message whose `reply.senderId` = me

| Condition | Outcome |
|---|---|
| `NM` off | ordinary group message (Table “plain message” rules, no escalation) |
| `H` | hidden rules win — no escalation, traceless |
| `M` ∧ `NM` on | **escalates** — notification shows despite mute (both paths) |
| `C='none'`/`W` off/in-app off/`S`, ∧ `NM` on | **escalates** past each (mention parity, exactly) |
| masked content (`C≠'full'` or `!P`) | body `«Alice replied to you»` (names replier, no message text) |
| full content | normal message body; SW may use `«Alice replied to you: <preview>»` wording |
| also mentions me | ONE notification, mention wording wins |
| 1:1 chat, or reply to someone else's message, or my own reply | no escalation — ordinary message |
| unread | `chat.unreadMentions` +1 when not viewing (cleared on read), same as mentions |

## Table 3 — Push-health (FR-013, all cases above)

Every SW wake outcome maps to an established shape: a shown note, `silenced`, or
`{note:null}` — each of which already ends visibly via spec-2016/2017/2023 (summary
re-assert / quiet generic / licensed Chromium skip). **No new outcome shapes may be
introduced.** The server is never consulted (FR-014).

## Settings contract

- `notifications.message.reactions` / `notifications.group.reactions`: independent gates
  (SC-005: each observably changes behavior from the settings screen).
- `notifications.reactions.sound`: page = in-app tone via `playTone` (`none` ⇒ silent banner);
  SW = `silent:true` iff `none`. Synced via `SYNCED_PREF_KEYS`.
