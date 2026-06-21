# Quickstart — verifying 9-AM-local version-announcement push

## Build / gates
```sh
cd server && go build ./... && go vet ./... && go test ./...   # store + handler + scheduler-selector
npm run build                                                   # client typecheck + build
```

## What to verify

### 1. Client reports version + tz (unit/spot-check)
- After `npm run build`, the `POST /v1/push/subscribe` body includes `installedVersion`
  (= `__APP_VERSION__`) and `tzOffsetMinutes` (= `getTimezoneOffset()`).
- Spot-check against the live dev stack (`make start`): in the app, enable notifications and
  watch the network/console — the subscribe request carries the two new fields.

### 2. Server persists + preserves (Go tests, in-memory fake store)
- Subscribe with `installedVersion`/`tzOffsetMinutes` → both persisted.
- Resubscribe **without** them (the SW path) → previously stored values **unchanged**
  (COALESCE).
- `MarkAnnounced(endpoint, V)` → `last_announced_version == V`.

### 3. `dueAtNine` selector (pure unit test — the core timing logic)
With an injected `nowUTC`, assert a subscription is selected **iff** its local hour
(`UTC − tz_offset_minutes`) == 9:
- UTC `09:30`, `tzOffsetMinutes = 0` (UTC) → **selected** (local 09:30).
- UTC `14:15`, `tzOffsetMinutes = 300` (EST, UTC−5) → **selected** (local 09:15).
- UTC `07:00`, `tzOffsetMinutes = -120` (CEST, UTC+2) → **selected** (local 09:00).
- UTC `03:30`, `tzOffsetMinutes = -330` (IST, UTC+5:30) → **selected** (local 09:00) — half-hour zone.
- Same subs one hour earlier/later → **not** selected.

### 4. `SubscriptionsBehind` filtering (Go test)
- A device on the current version → excluded.
- A device already announced for the current version → excluded.
- A device with NULL version or NULL tz → excluded (not a candidate).
- A behind, not-yet-announced device with version+tz → included.

### 5. Scheduler wiring (reasoning / log check)
- On a `dev`/empty version or nil notifier, the scheduler does nothing.
- On a real version, each ~15-min tick: `SubscriptionsBehind(current)` → `dueAtNine(now)` →
  `SendVersion` + `MarkAnnounced` per device. Confirm via `slog` on the dev stack that a
  tick runs and is a no-op when no device is due.

## Out of scope for automated verification
The end-to-end **push delivery at 09:00 local** can't run in the e2e harness (no push
service, no wall-clock/timezone control). The timing/targeting logic is covered by the pure
`dueAtNine` + store tests above; the rest is the existing, already-shipped SW
`{"t":"version"}` path (unchanged).
