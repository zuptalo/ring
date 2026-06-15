# Quickstart: Verifying Smooth Tab Transitions

How to reproduce the problem and confirm the fix. Assumes the standard dev stack.

## Run the app

```sh
make start          # PostgreSQL + ringd (air) + Vite on http://localhost:5173
```

Register/sign in with a dev invite code so the account has some chats, calls, and
contacts (the flicker is most visible with real data + a profile photo set).

## Reproduce the original problem (baseline)

1. Open the app on a phone or in a mobile-emulated viewport.
2. Tap rapidly between the four bottom tabs (Calls ↔ Chats ↔ Contacts ↔ Settings).
3. Observe on each switch (record a screen video and step frames if needed):
   - destination tab shows its **title first**, then the search bar / action
     buttons / filter chips pop in;
   - Calls/Contacts briefly show "No … found" before the list appears;
   - Settings shows a "You"/initials avatar that swaps to the real photo + name.

## Confirm the fix

After implementation, repeat the same steps and confirm the rendering invariants
in `contracts/rendering-invariants.md`:

- **R1**: every frame of a switch shows either the old tab or a fully-formed new
  tab — search bar, action buttons, filter chips, and list are present together.
- **R2**: nothing shifts position after the first frame of the new tab.
- **R3**: Settings shows the real photo + "Kamran" immediately, no "You" flash.
- **R4**: scroll a tab, leave and return — content and scroll position restored,
  no empty-state flash.
- **R5**: an empty account shows the empty state cleanly; a populated account never
  flashes the empty state.
- **R6**: rapid cycling stays fully rendered; check an RTL chat (existing bidi
  fixtures) looks correct.

## Automated checks

```sh
npm run build          # vue-tsc typecheck + vite build
npm run test:unit      # vitest: warm-store singleton + clearing-on-lock + useSelfProfile sharing
make db-up             # once, for e2e
npm run test:e2e       # Playwright incl. e2e/tab-transitions.spec.ts
```

The e2e spec drives the app via `window.__ringTest`, switches tabs, and asserts:
no empty-state element appears before the list on a populated account; a return
visit preserves content + scrollTop; the Settings display name is real on first
paint. RTL coverage stays in `e2e/bidi.spec.ts`.

## Notes

- The warm cache is **in memory only**; locking the app (or signing out) must clear
  decrypted profile/list values. Verify nothing plaintext is persisted in the clear.
- Do not change `swipeBackEnabled`/`scrollAssist` or the `switchTab('root',
  'replace')` semantics — those fixed a prior tab-highlight desync.
