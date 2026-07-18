# Quickstart — verifying spec 2043

## Automated gates (all currently green)

```sh
# Client typecheck + build
npm run build

# Focused unit suites
npx vitest run src/services/sw-guard.test.ts \
               src/services/push.rotate.test.ts \
               src/services/sw-quiet.test.ts
# (full suite: npx vitest run — 1174 tests)

# Server
cd server && go build ./... && go vet ./... && go test ./...
```

What they prove:
- `sw-guard.test.ts` — the burst stamp-bleed regression (a sibling event's show does NOT
  suppress this event's fallback), the clean-resolve backstop, and that licensed silence is
  still exempt.
- `push.rotate.test.ts` — `shouldRotateForQueueAge` truth table (empty / too-fresh /
  `lastWakeAt>=oldest` / `lastWakeAt==0` with old queue / within-vs-over the 2h cap).
- `relay_handlers_test.go` `TestRelayStatus` — count + null-when-empty, and that it does NOT
  dequeue (no side effects).

## Behavioral — the 5-message burst (SC-001)

Drive a backgrounded recipient through a rapid burst and assert every wake ended visibly,
via the dev test hook:

```js
// after pairing A→B and backgrounding B, A sends 5 messages fast, then:
const ledger = await window.__ringTest.pushWakeLedger();
// assert: no entry has outcome === 'fallback' beyond the expected, and none is silently
// dropped — every push wake produced 'shown' or 'licensed-silent'.
```

Run against the live `make start` stack with the `drive/` harness (real push wakes are not
reproducible headlessly; the ledger is the observable proxy).

## Prod before/after (SC-002) — measured via k3s

Baseline captured 2026-07-18: **`zombie_devices_24h = 13`**; fresh iPhone `1d0ca925` holds
**5** unacked frames.

```sh
kubectl exec -n ring ring-postgres-0 -- psql -U ring -d ring -tA -c \
 "select count(distinct rq.recipient) from relay_queue rq \
    join push_subscriptions ps on ps.user_id = rq.recipient \
   where rq.created_at < now() - interval '24 hours';"
```

After deploy, as devices foreground: the count should fall from 13 toward 0 (force-rotations
replace dead endpoints; the fresh subs wake and drain), and `1d0ca925`'s 5 frames should
clear. Watch the new `push: zombie fleet` log line in the `ringd` pod for the same trend.

## On-device diagnosis

Settings → Notifications → "Show notification diagnostics" (default off). When on, a generic
fallback notification shows a content-free reason token (`timeout`, `clean-resolve-no-show`,
…) so a real production device can report WHY it fell back — never sender or message content.
