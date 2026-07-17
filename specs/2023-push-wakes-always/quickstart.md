# Quickstart: verifying spec 2023

**Spec**: [spec.md](./spec.md) · **Date**: 2026-07-09

## Unit + typecheck (the CI gates)

```sh
npx vitest run src/services/sw-quiet.test.ts   # gate + predicate + license tests
npx vitest run                                  # full suite (871+ tests)
npm run build                                   # vue-tsc typecheck + vite build
```

What the tests must pin (see tasks.md for the red-first ordering):

- `platformTrustsSilence`: iOS Safari / CriOS / EdgiOS / FxiOS / macOS Safari
  / Firefox / empty / garbage → false; desktop+Android Chrome, Chrome-on-macOS,
  Edge, Samsung Internet → true.
- `mayEndWakeSilently`: WebKit UA + focused&visible client → false (the
  regression that motivates this spec); Chromium UA + focused&visible → true;
  Chromium UA + visible-unfocused → false.
- `anyClientVisible`: the previously-missing `{visibilityState:'visible'}`
  (focused absent) → false.
- `stampedShow`: stamp fires only on fulfillment; a rejecting show never
  stamps and still rejects for the caller.
- `countAccepted`: all-reject → 0, mixed → exact count, empty → 0.

## Wake-path inventory (SC-001)

Walk every `return` inside `dispatchPush`/`guardedPush` in `src/sw.ts` against
[contracts/wake-outcomes.md](./contracts/wake-outcomes.md) and record the
mapping in the PR description. Every row on the unsafe column must end in a
`showNotification` call or propagate to the guarded fallback.

## On-device (SC-004, dev iPhone)

1. Deploy the branch build to the dev host (`npm run build`, serve `dist/`
   via the laptop ringd — see the dev-deployment notes; the installed PWA
   needs the built client, HMR doesn't reach it).
2. On the iPhone PWA: open Ring, leave it FOREGROUND, then cut its socket
   (toggle Wi-Fi off/on quickly, or `make stop` + restart ringd) so the
   server sees no fresh connection.
3. From another account, send 5+ messages (each queues a push). Also exercise
   a Wall post and a friend request (socket-ungated tickles).
4. Expect: every push yields a visible outcome on the phone — rich note,
   or the silent "New message"/"New activity" quiet note (check Notification
   Center; quiet notes don't buzz). No wake may end with nothing.
5. Afterward the subscription must still be alive: background the app, send
   another message, the notification arrives. On the dev host the SW
   surfaces fallback reasons in the notification body (spec 2014) if
   something failed.
6. Server-side: `grep "push:" .tmp/ring-dev.log` — sends should stay 201 and
   the subscription must not get pruned.

## Desktop Chromium regression check

With the app open and focused in Chrome (any OS): send a message from another
account with the socket severed — no new notification-center entry should
appear (licensed silence, unchanged). With the window visible but another app
focused: the silent quiet note is expected (the already-applied predicate
tightening).
