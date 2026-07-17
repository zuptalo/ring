# Contract: consent-gated join request (spec 1041)

Scope: client↔client only, sealed inside existing `call-ice` frames (the
hold/resume/qos/joinroom pattern). The server relays opaque bytes; no server
schema, no new frame type, no new server state.

## Shape

Four new values in the existing `CallSignal.type` union:

```ts
type: … | 'joinreq' | 'joinreq-accept' | 'joinreq-reject' | 'joinreq-cancel'
// joinreq uses: callId (the recipient's own attempt / held call id),
//               roomId (the ongoing call's room — pre-minted for a 1:1),
//               kind   (the ONGOING call's kind, for the prompt copy)
// accept/reject/cancel use: callId + roomId
```

## Sender obligations (callee — the one in the ongoing call)

- MUST NOT send `joinreq` to a party in the rejected set for this call
  (rejection-final, FR-009) or past capacity (`canAdd`, FR-008).
- For a 1:1 ongoing call, mint the roomId at request time but convert to the
  room only on `joinreq-accept` (never strand a solo room on reject).
- On ongoing-call teardown with requests outstanding → `joinreq-cancel` each.
- The waiting party's attempt lifecycle is never extended: no retries, no
  reminder pings (FR-012/FR-013).

## Receiver obligations (the waiting/held party)

- `joinreq` with a matching live attempt (`meta.callId === callId`) → raise
  the consent prompt; NEVER auto-join (FR-004).
- Accept → send `joinreq-accept`, convert own attempt into `roomId` with own
  attempt's media kind (clarification A), reusing the captured stream.
- Reject → send `joinreq-reject`; the attempt continues untouched (FR-006).
- Prompt dismisses on `joinreq-cancel` or when the attempt ends for any
  reason (timeout/cancel/hang-up) — no lingering prompt (SC-005).
- Unknown `type` values are ignored (existing behavior) — old receivers
  simply never see a prompt and their attempt rings out normally.

## Compatibility with pre-1041 senders (the consent hole)

Old callees send a bare `joinroom` to a still-dialing party (today's
consentless auto-join). New receivers close the hole by gating on their own
state: `joinroom` while CONNECTED to that peer = the legitimate spec-1028
promote (auto-follow, unchanged); `joinroom` while still DIALING that peer =
treated as a join request → the same consent prompt, converting only on
accept (no reply is sent — the old sender doesn't understand one). If the
user declines, the old sender may briefly display a stale merged state; this
transitional blemish is deliberately preferred over honoring a consentless
join.

## Zero-knowledge

Identical envelope class to hold/resume/qos/joinroom: the server cannot
distinguish any of these from an ICE candidate. Names shown in prompts
resolve on-device.
