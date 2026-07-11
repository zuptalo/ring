# Quickstart: Simultaneous mutual calls (spec 1039)

## See the bug / the fix in the real app

```sh
make start                       # dev stack (Vite :5173 → ringd :8080)
```

Two browser profiles (or a browser + phone on the LAN), two paired test accounts, then
tap call on each other within ~1 second. Before the fix: both sit on "Calling…" (taps
< ~1s apart) or one side rings back at its own caller (taps ~1–2s apart). After: the
call just connects.

A scripted repro can use the `drive/` harness (`drive/README.md`): create two accounts,
`pair`, then fire `startDirectCall` on both pages in the same tick via the
`window.__ringTest` hook and screenshot both call screens.

## Unit tests (decision table)

```sh
npx vitest run src/services/call/glare.test.ts
```

## E2E (two real browsers, real WebRTC)

```sh
make db-up                       # once
npm run test:e2e -- mutual-call  # e2e/mutual-call.spec.ts
```

Scenarios covered: same-kind audio + video mutual attempts at 0ms/~1s offsets (both
connect, no incoming UI, one history entry each), mismatched kinds (ring on the
yielder, no camera without accept), different-caller-during-setup (busy/call-waiting,
outgoing attempt intact).

## Manual cue check (FR-008, not machine-checkable)

During a same-kind mutual attempt, listen on the yielding device: the "calling" tone
must transition straight into the connected call — the incoming ringtone must never
play. (E2e asserts the UI level: no incoming screen; tones are verified by ear here.)

## Full gates before calling it done

```sh
npm run build                    # vue-tsc typecheck + vite build
npx vitest run                   # unit suites + coverage floors
npm run test:e2e                 # full e2e
```
