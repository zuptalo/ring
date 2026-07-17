# Quickstart: Building & Verifying Hidden Chats

A practical guide to implementing and checking the feature slice-by-slice. Each
user story is an independently shippable increment.

## Prerequisites

```sh
make start        # Postgres + ringd (air) + Vite at http://localhost:5173
```

Client changes need a rebuild to show on installed/phone PWA; in-browser dev sees
them via Vite HMR. Typecheck/build gate:

```sh
npm run build     # vue-tsc --noEmit (typecheck) THEN vite build — run after TS/Vue edits
```

This is a **client-only** feature — no `server/` changes, no SQL migration, no
`DB_VERSION` bump.

## Suggested build order (by user story / priority)

### Slice 1 — Hide + reveal MVP (US1 + US3, P1)
1. `src/services/hidden-chats.ts`: master-key-wrapped hidden set
   (`getHiddenSet/isHidden/addHidden/removeHidden`) + separate-PIN
   (`enable/verify/changeHiddenPin`, modeled on `identity.ts`).
2. Exclude the set in `src/db/queries.ts` `listChats()` (single choke point).
3. `src/composables/useHiddenChats.ts`: in-memory reveal session + grace window
   (mirror `useAutoLock.ts`); always start locked on cold load.
4. `ChatActionsSheet.vue`: "Hide chat" action (prompts to create the PIN the
   first time). Reveal: PIN typed into the `ChatsPage.vue` searchbar.
- **Verify**: hide a chat → gone from Chats tab + search; type PIN in searchbar →
  it reappears; background briefly → still revealed; fully close → re-locked.

### Slice 2 — Coexisting distinct conversation (US2, P1)
5. `startHiddenChat(contactId)` → `createGroup('', [contactId])` + add to set.
6. Entry point to start a hidden chat with a contact.
- **Verify** with `drive/`: a normal 1:1 with a friend stays listed while a
  separate hidden chat with the same friend exists and only shows on reveal; the
  two histories never merge; the friend's device shows a normal separate group.

### Slice 3 — Private notifications (US4, P2)
7. `src/services/sw-inbox.ts` `noteForPayload()`: generic note + `/tabs/chats`
   url for hidden chats; keep burst-coalescing intact.
- **Verify**: from another account, message a hidden chat → notification shows no
  sender/avatar/body; tapping lands on Chats tab, chat still hidden.

### Slice 4 — No call-history trail (US5, P2)
8. Filter `listCallGroups()` (and missed-call badge) by the hidden set.
9. `useCall.ts`: generic caller identity for incoming calls from a hidden chat.
- **Verify**: place/miss calls in a hidden chat → absent from Calls tab; incoming
  call shows a generic caller pre-answer.

### Slice 5 — Biometric unlock (US6, P3)
10. `revealWithBiometric()` + `privacy.hiddenChatsBiometric` toggle; PIN fallback
    always works.

### Slice 6 — Reset PIN: wipe + block re-sync (US7, P3)
11. Local-only do-not-resync tombstone variant + `pullOwnData()` ingest skip.
12. `resetHiddenChats()` (delete local data, add blocks, clear set + PIN) behind a
    danger action with explicit destructive confirm in settings.
- **Verify**: with hidden chats present, reset → warned → confirmed → local
  history gone and does NOT re-appear after a sync pull.

### Settings (supporting, any time)
13. `src/settings/schema.ts`: `privacy-hidden-chats` screen (enable, set/change
    PIN, reset PIN [danger+confirm], biometric, grace choice
    `immediately`/`1m`/`5m`, default `1m`).

## Tests (TDD — write first, per Constitution III)

- **Unit (vitest)**: hidden-set wrap/unwrap; `verifyHiddenPin` (right/wrong, no
  leak); `listChats()` excludes hidden / includes when revealed; `listCallGroups()`
  exclusion + missed badge; `noteForPayload()` generic rendering + url; reset
  wipe + do-not-resync block prevents `pullOwnData` re-add; reveal session
  re-locks on simulated cold start.
- **e2e (`e2e/hidden-chats.spec.ts`)**: hide → reveal → unhide; coexisting hidden
  chat with same contact; hidden-chat notification has no preview; hidden call
  absent from Calls tab; reset wipes and does not resurrect. Keep to 2-account
  flows (3-person mesh is too flaky for headless CI — see project memory).
- **Manual (`drive/`)**: multi-user coexistence + screenshots for the reveal UX.

## Done = green gates (Constitution VII)

```sh
npm run build                 # client typecheck + build
cd server && go build ./... && go vet ./... && go test ./...   # unaffected, must stay green
npm run test:e2e              # needs `make db-up`
```

## Before `/speckit-implement` (mandated)

- Run **`/speckit-checklist`** — required for crypto / zero-knowledge specs.
- Line up a **security review** of: the master-key-wrapped set, the separate-PIN
  wrap/verify, the reveal-session lifecycle, and the local-only do-not-resync
  block. (Confirm none of them ever touch the wire.)
