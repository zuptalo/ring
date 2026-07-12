# Contract: `GET /v1/connections` outgoing set change (spec 1040)

> **Amended during implementation**: the widened set is served ONLY for
> `GET /v1/connections?include=accepted`. The default response keeps its
> existing meaning (UNRESOLVED requests, pending/rejected) because clients and
> the e2e suite treat a request leaving that list as answered
> (`e2e/friendship.spec.ts:54` pins it; CI caught the regression). The SW's
> `previewConnections` is the only `include=accepted` caller; the store method
> behind it is `OutgoingWithRecentAccepts`.

## Today

`Store.OutgoingRequests` (`server/internal/store/connections.go:149-153`)
returns the caller's sent requests with `state IN ('pending','rejected')`.
Accepted requests are never echoed back, so the client SW's accepted-note
builder (`sw-inbox.ts:1020`) is dead code and acceptances fall through to the
misleading "New friend request" placeholder.

## Change

```sql
WHERE requester::text = $1
  AND ( state IN ('pending','rejected')
     OR (state = 'accepted' AND updated_at > now() - interval '24 hours') )
ORDER BY updated_at DESC
```

- Response DTO shape unchanged: `{requester, target, state, updatedMs}`.
- `accepted` rows appear only while fresh (24h), bounding response size and
  guaranteeing at-most-once announcement: the SW conn ledger dedups for 48h,
  strictly longer than the visibility window (FR-022).
- No new information: the server already stores `connections.state`; this
  echoes a requester's own request state back to them.

## Consumers (verified)

- `src/services/connections.ts:61-68` — passes `state` through verbatim.
- `ContactsPage.vue:289` — renders only `state === 'pending'`; accepted rows
  invisible to the list. Badge counts use incoming only (`useBadges.ts:45`).
- `sw-inbox.ts:1018-1022` — the intended consumer: accepted → "accepted your
  friend request", rejected → "declined your friend request".

## Tests

- Fake store + handler test: accepted-within-24h present, accepted-older
  absent, pending/rejected unchanged, DTO state passthrough.
