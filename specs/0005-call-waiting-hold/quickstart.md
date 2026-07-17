# Quickstart: verifying call waiting

Phase 1 for spec 0005. How to exercise hold/swap/drop end-to-end once implemented. Uses the
same harnesses as spec 0004: the hermetic Playwright e2e (`npm run test:e2e`) and the
interactive `drive/` harness against `make start`.

## Prerequisites

- `make db-up` (docker Postgres) running.
- The spec 0004 calling work merged (this builds on it): mesh group calls, the busy/second-
  incoming signalling, the cue mechanism, and the `window.__ringTest` call hooks.

## Walkthrough (the six stories)

Drive ≥ 3 accounts (A, B, C) — and a 4th (D) for the cap test — through the dev hook.

1. **Take a second without losing the first (US1)**
   - A calls B; B accepts → connected.
   - C calls A. A's incoming UI offers **Accept & hold**. A accepts-and-holds.
   - Assert: A↔B media is paused both ways and B shows "on hold"; A↔C connects with live
     media. (`__ringTest`: A has an active call (C) + a held call (B); B sees `remote-held`.)

2. **Swap (US2)**
   - A swaps. Assert A↔C goes on hold (C sees "on hold"), A↔B resumes (media restored). Swap
     ≥ 3 times; each time exactly one call is active and one held, indicator tracks the held.

3. **Group hold isolates the holder (US1/US2/SC-003)**
   - A, B, C in a group call; D calls A; A accepts-and-holds the group.
   - Assert: B↔C media continues unaffected; B and C see A "on hold"; A↔D is live. A swaps
     back → A's legs re-publish, B/C see A active within a few seconds.

4. **Drop (US3)**
   - With one active + one held, A ends the **active** call → the held call resumes as the
     sole normal call. Repeat ending the **held** call → the active is undisturbed.
   - Remote side of the **held** call hangs up while held → A's held slot frees, A informed,
     active call untouched (SC-005).

5. **Two-call cap (US4)**
   - A is in two calls (active + held). D calls A → D gets **busy/unavailable**; A is NOT
     shown a third prompt (SC-004).

6. **Cues (US5)**
   - The second-call alert, hold, resume, and swap each play a distinct cue; disabling "Call
     sounds" silences them (SC-006).

## Automated (e2e)

New `e2e/call-waiting.spec.ts` (chromium), reusing the spec 0004 helpers
(`startGroup`/`accept`/`recordCues`/`groupDiag` + new `acceptAndHold`/`swapCalls`/`endHeld`
hooks):

- accept-and-hold pauses the first call (no media to the held peer; `remote-held` set);
- swap restores/repauses correctly across ≥ 3 swaps;
- group hold leaves the other members' mesh intact (their `remoteStreamCount` unchanged);
- drop active resumes held; drop held leaves active; remote-ends-held frees the slot;
- third caller at the cap gets busy;
- cues fire and are silenced when tones are off.

iOS/Safari (WebKit) is not exercised headlessly (same Playwright limitation as 0004); verify
hold/swap on-device via `make deploy-dev` (ring-dev) on an iPhone — the hard iOS constraint.

## Zero-knowledge spot check

While holding/swapping, confirm the server logs show only relayed **sealed** call signals —
never a plaintext hold/resume marker, and nothing that distinguishes a hold from any other
sealed signal (FR-012). No new server tables/state; no DB migration.
