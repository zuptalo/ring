# Contract: Push-Wake Terminal Outcomes

**Spec**: [spec.md](./spec.md) · **Date**: 2026-07-09

The behavioral contract `src/sw.ts` must satisfy after this fix. "Quiet note"
= the existing spec-1034 content-free notification (silent, self-replacing
tag, no sender/chat/content). "Trusted" = `platformTrustsSilence(ua)` (Chromium
engine, non-iOS); "unsafe" = everything else (all WebKit, Firefox, unknown).

**Master rule (FR-001)**: on unsafe platforms, EVERY row below ends in a
`showNotification` call. Licensed silence exists only on trusted platforms
with a focused AND visible client, or after a page claim on a trusted
platform.

| # | Wake kind | Situation | Trusted platform | Unsafe platform |
|---|-----------|-----------|------------------|-----------------|
| 1 | call | always | ring notification | ring notification |
| 2 | msg | live page claims within window (rendered banner, or the locked-hidden-chat claim) | silent (claim honored) | quiet note after the ack |
| 3 | msg | authoritative drain, notes shown (count > 0) | rich note(s) | rich note(s) |
| 4 | msg | authoritative drain, zero notes OR zero accepted shows | quiet note unless focused+visible client | quiet note, always |
| 5 | msg | preview path, rich notes (count > 0) | rich note(s) | rich note(s) |
| 6 | msg | preview path, generic arm (timeout / undecryptable / locked) | loud generic | loud generic |
| 7 | msg | nothing-new, fresh summary changed | silent re-assert (a show call) | silent re-assert (a show call) |
| 8 | msg | nothing-new, no summary / identical signature / silenced / suppressed / zero accepted shows | quiet note unless focused+visible client | quiet note, always |
| 9 | msg | slow-decrypt generic later found silenced (settle downgrade) | quiet note unless focused+visible (loud generic already visible) | quiet note (loud generic already visible) |
| 10 | conn | app fully closed | conn note(s), or placeholder if none/zero accepted | same |
| 11 | conn | any client exists | quiet note unless focused+visible | quiet note, always |
| 12 | post | app closed + Wall toggle on | post note(s) / placeholder | same |
| 13 | post | toggle off, or any client exists | quiet note unless focused+visible | quiet note, always |
| 14 | post-activity | app closed + activity toggle on, notes preview (count > 0) | activity note(s) | same |
| 15 | post-activity | toggle off / clients exist / removal previews to zero / zero accepted | quiet note unless focused+visible | quiet note, always |
| 16 | version | app fully closed | what's-new notification | same |
| 17 | version | any client exists | quiet note unless focused+visible | quiet note, always |
| 18 | any | dispatch throws or exceeds deadline, nothing accepted this event | guardedPush fallback generic | same |
| 19 | any | quiet-note show itself fails where it is the wake's only remaining visible ending | failure propagates → row 18 | same |

Failure semantics:

- "Accepted" means the `showNotification` promise fulfilled. A rejected or
  hung show is not accepted, is never recorded in the guard stamp, and never
  counts toward a show count (rows 3/5/10/12/14 fall to their zero-accepted
  row).
- Row 18's guard record (`lastNotificationAt`) is written on fulfillment
  only; a wake whose only show attempt rejected always reaches the fallback.
- Row 2's quiet note failing → propagates (row 19). The page↔SW message
  protocol is unchanged: same `ring:drain` / `ring:handled` messages, no new
  fields.
- Row 19 carve-outs (FR-005): the settle downgrade (row 9 — a loud generic is
  already accepted and showing) and the authoritative-drain degrade (row 4's
  catch reroutes to the preview flow, whose own quiet terminal propagates)
  MAY contain a quiet-note failure locally; every other quiet call site lets
  it propagate.
- The upgrade arm (row 5 during settle) closes the already-accepted generic
  only AFTER the upgrade shows report accepted > 0 — a failed upgrade never
  destroys the wake's existing visible ending.

Out of scope (unchanged): notification click routing, badge counts, straggler
re-fetch loop, server push-sending policy, page-side rendering decisions.
