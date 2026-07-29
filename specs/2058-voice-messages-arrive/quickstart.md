# Quickstart: reproducing and verifying spec 2058

## The bug in one sentence

An incoming voice message whose audio bytes are not on the device yet renders as an empty bubble —
timestamp and reaction button, nothing else — with no player, no download button, and no way back.

## Reproduce it by hand (dev stack)

The genuine trigger needs a push into a closed app, so the fastest honest reproduction uses two
devices against the dev stack.

```sh
make start        # Vite :5173 → ringd :8080
```

1. Pair two accounts and open a 1:1 chat.
2. **Fully close** the receiving side (close the PWA / background the tab — it must not be the
   foreground page, or the live path fetches the audio inline and the bug hides).
3. Send a voice message from the other account.
4. Open the receiving side and go to the chat **before** it finishes backfilling.

Expected today: a blank bubble. The window is short on a fast connection, which is why the
automated test seeds the state directly rather than racing it.

The second, permanent path: put the receiving device offline, receive a voice message, and observe
that it never recovers — a failed fetch strands it with no retry affordance.

## Reproduce it deterministically (the test seam)

The state is unreachable from a test today — `testhook.seedMedia` always sets `mediaId` and
`outgoing: true`. This feature adds `seedPendingIncoming(chatId, kind)` for exactly this:

```js
// in the receiving page context
const mid = await window.__ringTest.seedPendingIncoming(chatId, 'voice');
await window.__ringTest.mediaInfo(mid);   // → { hasMedia: false, pending: true, ... }
```

Then assert on what the bubble actually renders. **Assert rendered content, not the flag** — a test
that only checks `pending === true` passes both before and after the fix and proves nothing:

```js
const bubble = page.locator(`.bubble[data-mid="${mid}"]`);
await expect(bubble).toBeVisible();
// the real assertion: the bubble body is not empty
await expect(bubble.locator('.vp-pending')).toBeVisible();
```

## Verify the fix

| What | How | Covers |
|---|---|---|
| Blank bubble is gone | Seed a pending incoming voice message; the bubble shows a voice placeholder with its duration | US1, FR-001, FR-002, SC-001 |
| Self-heals on view | Seed pending, scroll the bubble into view, wait; it becomes a real player with no tap | US1, FR-005, FR-007, SC-002 |
| Manual retry works | Go offline, seed pending, tap → fails visibly; go online, tap → plays | US2, FR-003, FR-008, SC-003 |
| No double fetch | Tap repeatedly during a fetch; only one runs | FR-004 |
| Retry is bounded | Keep the fetch failing, scroll in/out repeatedly; automatic attempts stop, manual tap still works | FR-006 |
| Round notes too | Same as row 1 with a round video note | US3, FR-011 |
| Nothing fails silently | Offline, tap a pending photo/video/audio/document → told at that moment, bubble reads failed after | US4, FR-009, FR-010, SC-007 |
| Deferred media untouched | Set photo auto-download to never; a pending photo scrolled into view does **not** self-fetch | FR-015 |
| Cleared media untouched | Free space on a downloaded voice message; it keeps "removed to free space" | FR-012 |
| No stampede | Seed 10 consecutive pending voice messages; all recover, scroll stays smooth, ≤3 fetches at once | SC-005 |
| Read receipts unharmed | `e2e/seen-on-view.spec.ts` still green | Risk mitigation |

## Gates

```sh
npm run build                      # typecheck (vue-tsc) + build
npx vitest run                     # unit
npx playwright test e2e/voice-pending.spec.ts e2e/seen-on-view.spec.ts
```

`make db-up` must be running for e2e; the harness boots its own isolated `ringd` on :8081 and Vite
on :5174 and does not touch the `make start` stack.

## Still owed after the gates are green

**SC-006 is a real-device check.** The reported failure is a Web Push into a closed iOS PWA, which
headless cannot produce. Before calling this shipped: send a voice message, and a reply carrying a
voice message, to a genuinely closed phone, and confirm both play.
