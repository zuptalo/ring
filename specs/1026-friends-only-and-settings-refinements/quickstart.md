# Quickstart: verifying spec 1026

Prereqs: `make start` (dev stack) for manual UI checks; `npm run test:unit` and
`npm run test:e2e` for automated coverage.

## US1 — Friends-only messaging

Automated: `npm run test:e2e -- friends-only` — a stranger's DM is dropped until the recipient
connects, then a new message lands (and the dropped one stays gone).

Manual (via `drive/` or two dev accounts):
1. Create accounts A and B; do NOT connect them.
2. From B, start a chat with A and send a message → A never sees it.
3. From A, add/connect B (Contacts → add, or accept a request) → a new message from B now appears.
4. Calls unaffected: start a group call from A including a non-contact of the other participant →
   all legs connect.

## US2 — Simpler Privacy screen

1. Settings → Privacy → confirm there is no "Advanced" row and no "Block unknown account messages".
2. Confirm "Disable link previews" is directly on the Privacy page.
3. Turn it on, share a URL in a chat → no rich preview is generated.

## US3 — Help guides

1. Settings → Help → confirm the how-to topics are listed (privacy, getting started, adding people,
   chats & groups, disappearing messages, hidden chats & app lock, calls, recovery key).
2. Open any topic → readable guidance shows.
3. Confirm no version line on Help; version still on Settings → About.
4. Confirm "Run self-test" is still present under Developer.

## US4 — Confirm auto-download reset

1. Settings → Storage and data → tap "Reset auto-download settings".
2. A confirmation prompt appears; Cancel leaves settings unchanged; Confirm restores defaults.

## US5 — Emoji fallback

1. React to a message with an emoji that has no bundled asset (a very new emoji).
2. Confirm the native glyph shows — never a persistent broken-image "?" box.

Automated (unit): `Emoji.vue` — on image error with no variation selector, it renders the native
glyph (no stuck broken image).

## US6 — Caption spacing

1. Open a settings screen with a multi-line group caption (e.g. Privacy → Seen receipts caption).
2. Confirm visible spacing between the last line and the card's bottom edge.

## Full gate before "done"

```sh
npm run build        # typecheck
npm run test:unit    # vitest
npm run test:e2e     # Playwright (needs make db-up)
```
