# Quickstart — Message status and presence on the chat list

How to build, test, and verify each slice. Client-only feature; no server or DB
migration.

## Build & unit test

```sh
npm run build      # vue-tsc typecheck + vite build (the CI typecheck gate)
npx vitest run src/services/message-status.test.ts   # pure tick-tier helper
npx vitest run src/composables/useGroupPresence.test.ts  # pure group-online derivation
```

TDD order (Principle III): write the failing pure-helper tests first —
`lastMessageTick(...)` tier mapping (incoming→none, failed→failed, seen-gate caps
at delivered, group tier via `groupProgress`) and `useGroupPresence` derivation
(contacts-only counting, allContacts vs mixed label, empty at zero) — then make
them pass, then wire the UI.

## Visual verification (drive/ against the live dev stack)

```sh
make start                                   # dev stack: Vite :5173 → ringd :8080
node drive/scenarios/list-status-presence.mjs   # NEW scenario for this feature
```

The scenario should, using the `window.__ringTest` hook:
- **P1**: two accounts DM; sender checks that its Chats-list row shows the tick
  advance sent→delivered→seen (and none when the peer replies last). Screenshot.
- **P2**: pin the chat; confirm the tile shows the tick bottom-left and the online
  dot bottom-right when the peer is online; both visible together with the unread
  badge. Screenshot.
- **P3**: a 3+ member group where all are contacts → header + row show "N online";
  add a non-contact member → wording becomes "N online contacts"; take everyone
  offline → nothing shown. Screenshot.
- **P4**: inside the group, online members' avatars show the dot; a member typing
  shows the activity indicator instead; dotted avatars == header count. Screenshot.

Screenshots land in `.tmp/drive/*.png` — read them to confirm placement in light
and dark themes.

## Behavioral coverage (e2e)

```sh
make db-up
npm run test:e2e -- e2e/list-status-presence.spec.ts   # NEW e2e for user-facing behavior
```

Cover at least: a list-row tick advancing to seen after the recipient reads
(reciprocity on), and the group header count matching the number of online member
dots. Follow the existing e2e presence/status patterns; poll via the harness
helpers (never `page.waitForFunction(() => promise.then(...))`).

## Manual sanity (zero-knowledge)

Confirm no new network traffic: with a group open, the only presence frames are
the existing `presence-sub`/`presence` for contacts (plus, if implemented, one
bounded `presence-sub` for the open group's members). No new endpoint is called,
nothing group-aware is sent, and a non-contact co-member never appears online.

## Definition of done (this feature)

- `npm run build` clean; new vitest green; e2e green where behavior changed.
- Drive screenshots confirm all four slices in light + dark (+ RTL sanity).
- No `DB_VERSION` bump, no server change, no new synced/persisted data.
- `/speckit-analyze` clean and `/speckit-checklist` (Principle I) completed.
