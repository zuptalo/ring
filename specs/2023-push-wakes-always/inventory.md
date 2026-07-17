# SC-001 Wake-Path Inventory — spec 2023

Row-by-row mapping of [contracts/wake-outcomes.md](./contracts/wake-outcomes.md)
to the implemented code (line numbers from the final `src/sw.ts` /
`src/services/sw-inbox.ts` on `fix/2023-push-wakes-always`). "Quiet terminal" =
`showQuietUnlessVisible` (sw.ts:239-243), whose only silence license is
`mayEndWakeSilently(ua, clients)` (sw-inbox.ts) = `platformTrustsSilence(ua) &&
anyClientVisible(clients)` — false on every WebKit/Firefox/unknown UA, so on
silence-unsafe platforms every row below ends in a `showNotification` call.

| Row | Code path | Verified ending |
|-----|-----------|-----------------|
| 1 call | dispatchPush → `showCall()` (unconditional) | ring notification; a rejection propagates to guardedPush (nothing stamped → fallback) |
| 2 msg, page claims | sw.ts:817-819: after `pageWillNotify` ack, `!platformTrustsSilence(ua)` → `showQuietNote('msg')` (no catch → row 19) | trusted: silent (unchanged); unsafe: quiet note in the same wake |
| 3 msg, drain notes accepted | sw.ts:505 `accepted = await showNotes(...)` | rich note(s) |
| 4 msg, drain zero notes OR zero accepted | sw.ts:522 `!r.notes.length \|\| accepted === 0` → quiet terminal; drain's catch (sw.ts:526-529) degrades a quiet failure to the preview flow (FR-005 carve-out) | quiet note unless licensed |
| 5 msg, preview notes | sw.ts:561 `accepted = await showNotes(...)`; `shownAny = accepted > 0` (sw.ts:565) | rich note(s); all-rejected → row 8 via `shownAny === false` |
| 6 msg, generic arm | sw.ts:568-573 `showGeneric(...)` | loud generic; rejection propagates (serializeNotify rethrows) → guardedPush |
| 7 msg, nothing-new, summary changed | `reassertFromSummary()` returns true only after its show resolved (sw.ts:298-331) | silent re-assert (a show call) |
| 8 msg, nothing-new residue / silenced / suppressed / zero-accepted | sw.ts:587 `if (!shownAny)` → quiet terminal (propagates) | quiet note unless licensed |
| 9 msg, settle downgrade | sw.ts:613-615 inside the settle `try/catch` (FR-005 carve-out: the loud generic from row 6 is already accepted and on screen) | quiet note replaces the loud generic in place (same tag), or the generic stays |
| 5↑ msg, settle upgrade | sw.ts:600-607: `upgraded = await showNotes(...)`; `if (upgraded > 0) closeByTag(GENERIC_TAG)` | the accepted generic is never destroyed for a failed upgrade |
| 10 conn, closed | `showConnNotification` (sw.ts:459-482): preview errors caught → placeholder always attempted; zero-accepted conn notes (sw.ts:467-472) fall to the placeholder; placeholder rejection propagates | conn note(s) or placeholder |
| 11 conn, clients exist | sw.ts:740 quiet terminal | quiet note unless licensed |
| 12 post, closed + toggle on | `showPostNotification` (sw.ts:404-424): zero-accepted (sw.ts:416) falls to the 'Ring / New activity on your Wall' show | post note(s) or placeholder |
| 13 post, toggle off / clients | sw.ts:759 quiet terminal | quiet note unless licensed |
| 14 post-activity, closed + toggle on, notes | sw.ts:777 `shownActivity = (await showConnNotes(notes)) > 0` | activity note(s); zero-accepted → row 15 |
| 15 post-activity residue | sw.ts:783 `if (!shownActivity)` quiet terminal | quiet note unless licensed |
| 16 version, closed | `showVersionNotification()` (sw.ts:370-397); config fetch failure caught, show always attempted; rejection propagates | what's-new notification |
| 17 version, clients exist | sw.ts:797 quiet terminal | quiet note unless licensed |
| 18 guarded fallback | sw.ts:870-887: fallback fires when `lastNotificationAt < startedAt`; the stamp is written ONLY on show fulfillment (`stampedShow`, sw.ts:850-861 / sw-inbox.ts) so a rejected or hung show can no longer suppress it | fallback generic |
| 19 quiet-note failure | `showQuietNote` has no catch (sw.ts:222-230); callers at 522*/587/740/759/783/797/818 propagate to guardedPush → row 18 (*row-4 carve-out degrades to the preview flow first, whose row-8 terminal propagates) | fallback generic |

Straggler loop (sw.ts:637-652) is post-terminal catch-up (out of contract
scope): its `showNotes` count is deliberately unused — the wake already ended
visibly before the loop starts.

Licensed-silence outcomes remaining (trusted platform + focused & visible
window only): rows 2 (claim, trusted), 4/8/11/13/15/17 (quiet-terminal skip,
trusted). On WebKit/Firefox/unknown: none.
