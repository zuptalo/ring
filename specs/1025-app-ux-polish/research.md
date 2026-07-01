# Phase 0 Research: App-wide UX polish and fixes

Resolves the spec's open assumptions and records the grounded approach per item, from a codebase
survey.

## R1 — In-app vibration on the PWA (drives FR-021)

**Decision**: Remove the Vibrate toggle from In-app notifications.

**Rationale**: The toggle `notifications.inapp.vibrate` (`src/settings/schema.ts:610`) is consumed only
in `src/services/notify.ts` `inAppSoundAndHaptics()` via `navigator.vibrate?.(40)`. On iOS Safari /
installed PWA there is no Vibration API, so the optional chain silently no-ops; on Android it is
limited to a foregrounded user-gesture context and never fires for background (service-worker)
notifications. It is a control that does effectively nothing on the primary target.

**Alternatives considered**: Keep the toggle but hide on iOS (rejected: still misleading on Android
background); wire haptics via a native plugin (rejected: Ring is a PWA, no native layer).

## R2 — Call data-usage bytes (drives FR-017 totals)

**Decision**: Derive Calls totals on-device from existing `Call` records; no new capture or storage.

**Rationale**: `Call` (`src/db/types.ts:365-386`) already stores `durationSec` and `bytes` (total
sent+received). `useCall.ts` samples WebRTC `getStats()` (line ~900), accumulates bytes, and passes
`totalBytes` to `finishCall(...)` on end. So minutes and data are already persisted per call. Totals
are a pure client-side aggregation grouped by kind (audio/video).

**Edge rule**: A call with no recorded `bytes` (older/interrupted) contributes 0 to the data total but
still contributes its `durationSec` to the minutes total. Zero-duration calls count as 0 minutes.

## R3 — Help self-test (drives FR-022)

**Decision**: Keep "Run self-test"; fix the stale hardcoded version instead.

**Rationale**: `/settings/selftest` → `SelfTestPage.vue` runs `runSelfTest()`
(`src/services/crypto/selftest.ts`), a genuine on-device crypto verification (primitives, envelope,
X3DH + Double Ratchet, sender keys, media encryption) with a pass/fail summary. It is meaningful, so
it stays. The real cleanup is the Help "Version" stat, hardcoded to `'0.1.0'` (`schema.ts:702`) — it
should show `__APP_VERSION__` like the About screen.

## R4 — Cold-start deep-link back navigation (FR-001..004)

**Decision**: Seed `/tabs/chats` into history beneath the deep-link target on cold start.

**Rationale**: On a cold start the only base history entry is the deep link's own URL (`main.ts`
re-seeds `window.location.href`), so Back underflows to a blank shell. Notification targets already
resolve to tab or detail routes (`/chat/:id`, `/tabs/wall`, `/tabs/contacts`, `/`, and calls route
to `/call-active` from `useCall`). Fix in the single consumption choke point `App.vue routeRelevant`:
when routing to a cold-start deep link, ensure a `/tabs/chats` entry sits under it (replace to Chats,
then push the target), and adjust the `main.ts` base seed so the underlying entry is Chats for a
deep-link landing. The catch-all `→ /tabs/chats` redirect stays as the backstop.

## R5 — Media viewer video poster (FR-010..012)

**Decision**: Use the large poster tier for the viewer and let the video element fill the frame.

**Rationale**: The viewer thumb is `stripUrl` (128px `posterStrip`) first (`ChatDetailPage.vue:1446`),
and `VideoPlayer .vid-el` lacks `width/height:100%`, so the poster renders at 128px in a large blank
frame. Fix: for the full-screen viewer prefer `posterUrl` (512px `posterBlob`) over `stripUrl`, and
give `.vid-el` `width:100%; height:100%; object-fit:contain`. Tiers already exist per `Media`
(`posterBlob`/`posterGrid`/`posterStrip`); older messages without a large tier fall back to what they
have (backfill already exists from spec 1014).

## R6 — Hidden-chat swipe reveal (FR-008..009)

**Decision**: Give hidden-chat rows an OPAQUE background so the swipe reveals buttons cleanly.

**Rationale**: `ChatListItem.vue` `.hidden-row` sets `--background: rgba(...medium..., 0.1)` (near
transparent). In `ion-item-sliding` the item slides over the options; a near-transparent item lets
the buttons beneath bleed through while the row content (name/avatar/date/eye) appears to float on
top of them — the reported glitch. Fix: composite the subtle hidden tint over an opaque base (or use
a solid themed background like normal rows), so the row is opaque and the buttons are only visible in
the revealed area. No row is non-swipeable today; this is purely a background-opacity fix.

## R7 — Show-preview title (FR-005..007)

**Decision**: When "Show preview" is off, genericize the notification TITLE (sender), not only the
body. Hidden-chat precedence already wins.

**Rationale**: `showPreview` is wired for the body in both `sw-inbox.ts` (background) and `notify.ts`
(foreground), but the title keeps the sender/group name. Per FR-005 the sender must also be hidden
when preview is off. The hidden-chat early-return generic branches (`sw-inbox.ts:211`,
`notify.ts:387`) already run before the preview logic, so hidden chats stay generic regardless — keep
those checks first; only add title genericization to the non-hidden preview-off path.

## R8 — Disappearing countdown placement (FR-013..014)

**Decision**: Increase spacing and, for incoming messages, place the countdown to the right of the
timestamp via a direction-scoped CSS order.

**Rationale**: `.ttl-left` is rendered before the timestamp inside `.time`; `.msg-foot.in .time` is
left-anchored, so the countdown hugs the bubble's left edge. Add spacing (a margin on `.ttl-left`)
and, under `.msg-foot.in`, reorder so `.ttl-left` follows the timestamp.

## R9 — Calls date + button swap (FR-015..016)

**Decision**: Add a `formatDay` helper (`YYYY-MM-DD`) in `utils/time.ts`; use it in `CallsPage.vue`
and `CallDetailPage.vue`. Swap the Message and Video action columns on `CallDetailPage.vue` (current
order Message → Audio → Video becomes Video → Audio → Message).
