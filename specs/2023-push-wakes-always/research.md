# Research: Push Wakes Always End Visibly Where Silence Is Unsafe

**Spec**: [spec.md](./spec.md) · **Date**: 2026-07-09

Phase 0 for this hotfix was performed *before* the spec, as a 20-agent
adversarially-verified review (platform research against WebKit source, a diff
review of an externally-proposed fix, an exhaustive silent-path sweep of
`src/sw.ts`, and a page-ack audit). This file consolidates the decisions.

## D1. Root cause: licensed silences, not a stale-visibility bug

**Decision**: Treat the *licensed* silent endings as the bug. Apple's
enforcement (verified in WebKit main): webpushd starts a ~30s timer per
delivered push waiting for `showNotification`; on expiry it increments
`silentPushCount` (the only write is `+ 1`; no reset API exists); at
`maxSilentPushCount = 3` ALL of the origin's subscriptions are removed. The
only exemptions are Web Inspector and declarative web push — there is NO
visible/focused-page exemption. Chrome, by contrast, documents "the one
exception is when the user has your site open and focused" and never revokes
(it shows its own generic fallback instead).

**Rationale**: This mechanism alone explains the persisting revocations
without any platform bug: pushes arrive while a window is genuinely visible
(stale-socket foreground for messages; conn/post/post-activity/version tickles
are not socket-gated at all), the SW legally skips, and three such wakes over
the subscription's lifetime kill it.

**Alternatives considered**: The externally-proposed diagnosis (frozen iOS
clients reporting a stale `visibilityState === 'visible'`) is architecturally
possible (focused/visible travel in one cached ServiceWorkerClientData
snapshot) but undocumented in the web-push era; the documented modern matchAll
failure on iOS is an EMPTY list (WebKit bug 268797), which fails in the safe
direction. The tightened focused+visible predicate is kept (it strictly
narrows silence and matches Chrome's wording) but is not relied on as the fix.

## D2. Gate by browser engine, not operating system

**Decision**: `platformTrustsSilence(ua)` returns true only for confident
Chromium-engine UAs (`Chrome/`, `Chromium/`, `HeadlessChrome/`, `Edg/`
tokens), and false for iOS skins (`CriOS`, `EdgiOS`, `FxiOS`, or any
`iPhone|iPad|iPod` token), Safari everywhere, Firefox, and anything
unrecognized.

**Rationale**: The strike counter lives in Apple's push daemon, which only
WebKit-engine browsers use. Chrome/Edge on macOS run Chromium's engine and
Chromium's push service, with the documented focused exemption — treating them
as unsafe would spam the platform the user most likely works on all day, for
zero safety gain. Every iOS browser is WebKit underneath, so iOS skins gate as
unsafe. Firefox has its own push quota system with no documented on-page
exemption → unsafe (over-notifying is harmless there; the note is silent).
iPadOS "desktop mode" masquerades as macOS Safari → no Chromium token →
unsafe, the safe direction. Samsung Internet/Opera/Brave carry the `Chrome/`
token and are genuinely Chromium → safe.

**Alternatives considered**: OS-keyed gating (rejected — misclassifies
Chrome-on-macOS, see spec Clarifications); feature detection (rejected — no SW
API distinguishes push-service backends); assuming everything unsafe
(rejected — needless permanent behavior change for the majority-safe Chromium
fleet and it erases the documented, deliberate spec-1034 UX on desktop).

## D3. Keep the page-claim handshake; follow it with the quiet note on unsafe platforms

**Decision**: The `pageWillNotify` ack keeps suppressing the SW's *rich*
notification everywhere. On silence-unsafe platforms the SW additionally shows
the content-free quiet note after the ack — gated ONLY on the platform, not on
client visibility, so Chromium's claim outcome stays byte-identical.

**Rationale**: The claim exists to prevent a loud duplicate of the in-app
banner. Removing it on Apple would replace one silent strike with a loud
double-announce on every foreground message. The quiet note (silent:true,
self-replacing tag, no content) satisfies webpushd while staying nearly
invisible to the user; the app's existing foreground cleanup clears it. This
also closes the zero-render hidden-chat claim arm by construction, with no
page-side change and no new page↔SW message.

**Alternatives considered**: Extending the ack protocol with a
`rendered: boolean` so the SW could show the quiet note only for zero-render
acks (rejected — on Apple even rendered-banner acks strike, so the
distinction buys nothing there and adds protocol surface); making the page
show its own OS notification when claiming (rejected — duplicates SW logic,
needs Notification permission plumbing in a second place, and the page can be
killed mid-show).

## D4. Error-path hardening: a failed show is never a shown wake

**Decision**: (a) remove the swallowing catch inside the quiet-note terminal
so failures propagate to `guardedPush`; (b) stamp `lastNotificationAt` on
fulfillment of `showNotification`, not at call time; (c) `showNotes` /
`showConnNotes` return accepted-show counts and a zero count falls through to
the quiet/fallback terminal (the authoritative drain still acks frames whose
data is durably committed — the invariant that matters is the wake ending
visibly, not un-acking committed data).

**Rationale**: All three were confirmed by the review as ways a wake whose
show attempt FAILED still resolves as "visibly ended", which both ends the
wake silently and (b) actively suppresses the last-resort fallback whose only
job is this incident class. They only fire on platform-level show errors
(mostly permission-revoked, where nothing could show anyway), which is why
they are hardening rather than the headline fix.

**Alternatives considered**: Un-acking / re-queueing frames on show failure
(rejected — the frames are durably committed locally; re-delivery would
double-apply and the preview path would misread consumed ratchet keys as
decrypt failures — the existing markShown ledger comment documents this).

## D5. Test strategy: pure halves + reviewed inventory

**Decision**: Failing regression tests first (constitution III, hotfix band)
against the pure decisions in `sw-inbox.ts`: platform gate classification
table, `mayEndWakeSilently` composition, the previously-unpinned predicate
case (`{visibilityState:'visible'}`, `focused` absent → false). The `sw.ts`
wiring is covered by the per-kind × per-platform terminal-outcome contract
([contracts/wake-outcomes.md](./contracts/wake-outcomes.md)) reviewed as the
SC-001 inventory, plus the real-device recipe in quickstart.md.

**Rationale**: `sw.ts` imports workbox and SW globals and is not importable
under vitest; this is the established pattern of specs 1034/2016/2017/2020,
whose pure halves all live in `sw-inbox.ts` today.
