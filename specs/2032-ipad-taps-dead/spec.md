# Feature Specification: iPad Taps Dead on Send & Quick-React

**Feature Branch**: `fix/2032-ipad-taps-dead`

**Created**: 2026-07-13

**Status**: shipped
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User bug report (2026-07-13): "On iPad, send button doesn't work and tapping the emoji button to react on a message also doesn't open anything! But they work fine on my iPhone!"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every tap works on iPad (Priority: P1)

On an iPad, tapping Send delivers the typed message and tapping the react affordance opens the quick-react bar, exactly as on iPhone. No control in the chat screen may be dead on any supported device class.

**Independent Test**: On the reporter's iPad: type a message, tap Send → it sends; tap the react button on a bubble → the emoji bar opens. Regression fence: same actions still work on iPhone and desktop.

**Acceptance Scenarios**:

1. **Given** a chat with a typed draft on iPad, **When** Send is tapped by finger, **Then** the message sends.
2. **Given** a received message on iPad, **When** the react affordance is tapped, **Then** the quick-react bar opens and picking an emoji applies it.
3. **Given** the fix, **Then** iPhone and desktop behavior is unchanged (including the keyboard staying open while reacting, which is what the current pointerdown-prevent idiom protects).

## Root cause (CONFIRMED 2026-07-14, server logs + live probe)

**H1 was right, and it is a real server bug, not just a stale cache.** The chain:

1. An installed PWA's service worker serves the app shell cache-first (deliberate — iOS cold-start), so a long-lived install keeps running its old shell until an update is *applied*.
2. iPadOS evicted part of the old shell's precache (routine storage pressure), so lazily-loaded chunks went to the network with their OLD fingerprinted names.
3. The dev server's `dist/` had been rebuilt several times since — those names no longer exist.
4. `spaHandler`'s SPA fallback answered the missing `/assets/*.js` with **`index.html`, HTTP 200** (proven by live probe: `status=200 type=text/html` for a nonexistent chunk). The module loader received HTML as JavaScript, the chunk's features never wired up: dead Send, dead react button, no visible error.
5. No update prompt appeared because every new-worker install attempted DURING the rebuild storm hit a half-written `dist/` (precache fetch fails → the whole SW install aborts → no waiting worker → nothing to prompt about).

The iPhone escaped only because its precache was intact. H2 (pointerdown/click pipeline) was briefly withdrawn — then **reinstated and confirmed as a second, independent bug** by the post-heal field report: with a fresh shell, everything gesture-driven works on the iPad (hold-to-record audio, video notes, calls, long-press action menu — all pointer/gesture handlers) while exactly the click-actions behind a bare `@pointerdown.prevent` stay dead (composer Send, both react buttons, and by inspection the @mention picker rows and the banner quick-reply send). iPadOS's desktop-class pipeline honors the spec: canceling `pointerdown` for a touch pointer suppresses the synthesized `click`; iPhone Safari's legacy touch path forgives it, and so does Chromium (which is why the touch repro passed).

## Fix (this branch)

- **Server**: a missing `/assets/*` path now returns an honest **404** instead of the app shell — a dead fingerprinted chunk is never a client-side route. Regression test first (`static_test.go`: "missing hashed asset 404s", red → green).
- **Client self-heal**: `useAppUpdate` now listens for Vite's `vite:preloadError` (a lazy chunk failed to load) and pulls the waiting update / reloads through the existing `applyUpdate` machinery — one attempt per tab, never mid-call. A future stale device un-strands itself instead of sitting with dead buttons.
- **Stranded-device remedy (no code)**: with `dist/` stable again, one full close-and-reopen lets the new worker install cleanly and the normal prompt appears; failing that, reinstalling the PWA is the hard reset.
- **Input fix (bug #2)**: every BARE `@pointerdown.prevent` focus-guard paired with a `@click` action is now `@mousedown.prevent` (five sites: Send, 2× react, mention picker, banner quick-reply) — synthetic mouse events fire after the touch sequence, so the focus shift is still blocked on every platform and the click can never be cancelled. Regression pinned by a source-level guard test (`src/components/pointer-tap-guard.test.ts`, red with the five offenders → green), since the failing engine (iPadOS WebKit) cannot run in CI. `@pointerdown.prevent="handler"` (acting ON the down, e.g. PinPad) remains legal.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Send and quick-react MUST respond to touch taps on iPadOS (Safari and installed PWA), with iPhone/desktop behavior unchanged.
- **FR-002**: Per the hotfix rule (constitution III), the fix MUST start from a failing regression test where the cause is automatable; if the cause proves environmental (H1), the spec documents the root cause and any preventive follow-up instead.
- **FR-003**: The keyboard-preservation behavior the current idiom protects (reacting without dismissing the composer keyboard) MUST survive the fix.

## Zero-Knowledge Impact

None — device-local input handling / caching; nothing touches the wire.

## Success Criteria *(mandatory)*

- **SC-001**: Reporter confirms both actions work on the iPad (the only conclusive gate — the failing configuration cannot be emulated on the dev machine).
- **SC-002**: Existing chat e2e (send, quick-react, reply, mentions) stays green; the chromium-touch drive repro keeps passing.

## Assumptions

- Awaiting the H1/H2 discriminator from the reporter before the pipeline continues (clarify is effectively this one question).
