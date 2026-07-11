# Data Model: Simultaneous mutual calls (spec 1039)

No new persisted entities and no schema change. This feature is a state-machine
refinement over existing in-memory call state plus a call-log integrity rule.

## In-memory entities

### Outgoing attempt (existing, made explicit)

The unit the resolution reasons about. Today it is implicit in `callMeta` +
`callState`; the fix makes its lifetime crisp.

| Field | Source | Notes |
|---|---|---|
| `callId` | `callMeta.callId` | Also serves as the attempt token (R3) |
| `peerUserId` | `callMeta.peerUserId` | The callee |
| `kind` | `callMeta.kind` | `audio` \| `video` |
| `phase` | derived | `setting-up` (callState still `idle`, meta set) → `dialing` → `remote-ringing` → answered/ended |

**Lifecycle**: created synchronously when the user places the call (meta set) →
`setting-up` while capture/PC/offer-send run → `dialing`/`remote-ringing` → terminal
(connected, cancelled, yielded, failed, timeout). A yielded attempt MUST stop mutating
shared state the moment it yields (token check after every await).

### Mutual pair / glare decision (new, pure, not persisted)

Computed independently on each device by `src/services/call/glare.ts` when a 1:1 offer
arrives from `from` while an outgoing attempt exists:

Inputs: `selfId`, `from`, attempt (`peerUserId`, `kind`, `phase` unanswered), offer `kind`.

| Condition | Decision |
|---|---|
| No unanswered outgoing attempt to `from` | `none` (normal incoming / busy / call-waiting flow) |
| Attempt exists, `selfId < from` | `ignore` — we win; drop the crossing offer silently |
| Attempt exists, `selfId > from`, kinds match | `auto-accept` — yield our attempt, join theirs with no ring |
| Attempt exists, `selfId > from`, kinds differ | `ring` — yield our attempt, present theirs as a normal incoming call |

Invariants:

- Deterministic and symmetric: for any pair of crossing attempts, exactly one side
  computes `ignore` and the other computes `auto-accept`/`ring` (FR-002).
- Group offers and offers from a different user never reach the glare decision
  (`none`), preserving busy/call-waiting behavior (FR-006, FR-009).

## Persisted data (existing stores, integrity rules only)

### Call log entry (`calls` store via `src/db/queries.ts`)

- Winner side: keeps its normal outgoing record; it transitions to answered/ended as
  for any answered call. The crossing (yielded) offer never creates a record.
- Yielding side: the record `startDirectCall` created for the abandoned attempt is
  deleted (`deleteCalls([abandonedCallId])`); the auto-accept/ring path creates the
  single incoming record as usual (FR-007 / SC-005).

## State transitions touched (yielding side, kinds match)

```
placing call to A (meta set, callState idle, capture in flight)
        │  offer from A arrives → glare decision = auto-accept
        ▼
yield: invalidate attempt token · send call-cancel(abandoned callId)
       · delete abandoned call record · keep captured stream if resolved
        ▼
auto-accept surviving offer (no ring, no incoming UI):
       set meta incoming(A) · reuse/capture stream · answer sealed
        ▼
connected  (callState 'connecting' → 'connected' as any answered call)
```

All other transitions (decline, hang-up, timeout, busy, call waiting, group) are
unchanged.
