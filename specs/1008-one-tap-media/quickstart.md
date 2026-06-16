# Quickstart / Test Scenarios: One-Tap Media & Inline Quick-React

Behavioral coverage for spec 1008, driven through the real chat view (taps,
long-press) plus `window.__ringTest` for setup. Maps each Success Criterion to a check.

## Manual smoke (deploy-dev)

1. Open a chat with an image, a video, and an album.
2. **Tap** the image → full-screen viewer opens immediately (no menu). Tap the video
   → it opens and plays. Tap an album cell → viewer opens at that item. (SC-001)
3. On any message, tap the **reaction button** in the bottom row → a popover shows 7
   emoji + a trailing "+", all visible, no horizontal scroll. (SC-002)
4. Tap an emoji → applied, popover closes. Re-open, tap "+", pick a new emoji →
   applied; after a few uses it shows among the 7. (SC-003)
5. **Long-press** a message → the full menu opens (reply/forward/edit/save/copy/
   select/delete/info/reactions/view). (SC-004)
6. Confirm the bottom row is direction-aware: sent → time+tick right, react button
   left; received → time left, react button right.
7. Open a popover, then **swipe right to go back** → no popover lingers over the chat
   list. (SC-005)

## e2e (Playwright)

`e2e/quick-react.spec.ts` (new):

- **7 + "+" visible**: open the reaction button popover; assert 7 emoji buttons and the
  "+" are all present and visible (no scroll container needed). (SC-002)
- **apply**: tap the first quick-react emoji; assert the reaction is applied
  (`__ringTest.getReactions`). (SC-003)
- **custom enters most-used**: react with a non-default emoji via the existing tally;
  assert `__ringTest.quickReactEmojis(7)[0]` becomes it. (SC-003)
- **auto-dismiss on leave**: open a popover, navigate back, assert no `.ma`/quick-react
  popover in the DOM. (SC-005)

`e2e/message-menu.spec.ts` (update from 1004 semantics):

- **one-tap opens media**: send/paste an image; tap it → `.viewer-modal` visible (no
  "View" step). (SC-001)
- **long-press opens the full menu**: dispatch a long-press (pointerdown, wait >500ms,
  pointerup) on a text bubble → the full menu (`.ma`) appears with its actions. (SC-004)
- the existing 1004 assertions that single-tap opens the menu are replaced by the above.

## Notes

- Long-press in e2e: synthesize `pointerdown` → wait 550ms → `pointerup` on the bubble
  (the 500ms threshold from `useLongPress`), and assert the menu opened.
- The usage tally and emoji picker are reused from 1004; no new persistence to seed.
