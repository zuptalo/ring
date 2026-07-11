# Signalling contract: Simultaneous mutual calls (spec 1039)

**No wire change.** Every frame below already exists and keeps its exact shape; the
server relays sealed envelopes blindly as today. This document only fixes the required
*sequences* so both clients interoperate (including a new client against an old one).

## Frames used (all existing)

| Frame | Direction | Content |
|---|---|---|
| `call-offer` | caller → callee (sealed SDP) | the attempt itself |
| `call-answer` | callee → caller (sealed SDP) | accept |
| `call-cancel` | caller → callee (control) | caller withdraws an unanswered attempt (reason from existing vocabulary, e.g. `answered-elsewhere`) |
| `call-ringing` / `call-busy` / `call-end` | control | unchanged usages |

## Sequence — mutual attempt, kinds match

`A < B` (A's attempt survives; B yields). Both taps ~simultaneous.

```
A → B : call-offer(callA, kind K)          B → A : call-offer(callB, kind K)
A: offer callB crosses its own attempt → glare decision = ignore (A wins)
B: offer callA crosses its own attempt → glare decision = auto-accept
B → A : call-cancel(callB, answered-elsewhere)   (clears relay retention of callB)
B → A : call-answer(callA)                        (no ring, no manual accept on B)
A: receives call-answer(callA) → connects (normal answered-call path)
A: (whenever call-cancel(callB) arrives, before or after: no-op — callB was never
    presented; also dropped if redelivered later, spec 2012 retention)
```

## Sequence — mutual attempt, kinds differ

Same as above until B's decision, which is `ring`: B sends `call-cancel(callB, …)`,
then presents `call-offer(callA)` as a normal incoming call (kind shown). Accept /
decline proceed exactly as today (`call-answer` / `call-reject`).

## Sequence — different caller during setup window

```
B: placing call to A (unanswered attempt, any phase)
C → B : call-offer(callC)
B: glare decision = none (different peer) → existing busy / call-waiting flow
   (attempt to A is untouched)
```

## Compatibility

- **New yielder vs old winner**: old A already ignores a crossing offer once dialing;
  B's `call-answer` and `call-cancel` are frames old A fully understands. Works.
- **Old yielder vs new winner**: old B tears down and rings (today's behavior); new A
  ignores the crossing offer (unchanged). Works — just without auto-connect, and the
  setup-window race persists only on the old client.
- The only ordering requirement introduced: the yielding side sends `call-cancel` for
  its abandoned attempt no later than its `call-answer` send (best-effort; a lost
  cancel is healed by the existing stale-offer handling on redelivery).
