# Contract: mention payload + notification escalation

## Wire / payload contract (E2EE only — never plaintext to server)

A message that mentions people adds, inside the sealed `MessagePayload`:

```jsonc
{
  "body": "ping @<token>",       // existing
  "kind": "text",                 // existing
  "mentions": ["<memberId>", ...],// NEW: explicitly-mentioned member ids (omit/[] if none)
  "mentionsEveryone": true         // NEW: broadcast; only HONORED if senderId === group.createdBy
}
```

Invariants:
- `mentions` contains stable member ids (rename-proof); rendering resolves the current name.
- `mentionsEveryone` from a non-owner sender MUST be ignored by recipients (re-validate vs `createdBy`).
- The server sees only ciphertext + the existing content-free push — it MUST learn nothing here.

## Notification escalation decision table (recipient-side, shared by page + SW)

Inputs: `muted`, per-chat `content` (full/generic/none), `appVisible`, `isActiveChat`,
`isMention` (= notifyMentions!==false AND (self in mentions OR validated @everyone)),
global `showMessages` master, OS DND. Outcome = `notificationOwner` result.

| muted | content | isMention | appVisible | global master / DND | → outcome |
|------:|---------|:---------:|:----------:|---------------------|-----------|
| yes   | any     | no        | any        | on                  | suppress (normal mute) |
| yes   | any     | **yes**   | hidden     | on                  | **sw-notification** ("X mentioned you") |
| yes   | any     | **yes**   | visible    | on                  | **page-banner** ("X mentioned you") |
| yes   | none    | **yes**   | hidden     | on                  | **sw-notification** naming the mentioner (overrides content:none) |
| no    | none    | no        | any        | on                  | suppress / badge-only (unchanged) |
| any   | any     | yes       | any        | **off / DND**       | **suppress** (master + OS win; mentions never override) |
| any   | any     | yes (but notifyMentions=false) | any | on | normal (no escalation) |
| any   | any     | yes       | visible, isActiveChat | on        | suppress (already viewing) + clears the mention marker |

## UI contract

- Composer: `@` opens member autocomplete (name + @username); owner-only `@everyone` entry.
- Bubble: mention → tappable chip (→ contact page); self-mention emphasized.
- Chat row: `@` marker + unread-mentions count (separate from unread) when unseen mentions exist.
- In-chat: jump-to-mention scrolls to the next unseen mention; marker/count clear on seen.
