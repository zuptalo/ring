# Data Model: Push Wakes Always End Visibly Where Silence Is Unsafe

**Spec**: [spec.md](./spec.md) · **Date**: 2026-07-09

No persistent data changes: no IndexedDB store, no `DB_VERSION` bump, no
server schema, no settings key. The "model" is three pure decision shapes.

## PlatformGate (new, pure)

```
platformTrustsSilence(ua: string) → boolean
```

| Input class (user agent)                          | Result | Why |
|---------------------------------------------------|--------|-----|
| iOS skins: `CriOS` / `EdgiOS` / `FxiOS`           | false  | WebKit underneath, webpushd strikes |
| Any `iPhone` / `iPad` / `iPod` token              | false  | all iOS browsers are WebKit |
| Chromium engine: `Chrome/`, `Chromium/`, `HeadlessChrome/`, `Edg/` (and not an iOS skin) | true | Chromium push service; documented focused-page exemption; includes Chrome/Edge on macOS, Samsung Internet, Opera, Brave |
| Safari (no Chromium token), incl. iPadOS desktop-mode masquerade | false | webpushd |
| Firefox (`Firefox/`, no Chromium token)           | false  | own quota system, no documented exemption; over-notify is safe |
| Empty / unrecognized / spoofed                    | false  | fail to the safe direction |

Invariant: false is always safe on every platform (an extra silent
notification); true is only ever returned for engines documented to tolerate
silence.

## SilenceLicense (new, pure; composition)

```
mayEndWakeSilently(ua, clients) = platformTrustsSilence(ua) && anyClientVisible(clients)
```

`anyClientVisible(clients)`: some client has `focused === true` AND
`visibilityState === 'visible'`. Missing fields count as false (older
platforms fail closed). Unchanged truth table from the applied tightening,
now with the `{visibilityState:'visible'}`-with-`focused`-absent case pinned.

## ShowOutcome (changed semantics, `sw.ts` wiring)

- `showNotes(notes)` / `showConnNotes(notes)` → `number` (count of shows the
  platform ACCEPTED — fulfillment, not attempts).
- Callers: `count > 0` ⇒ wake visibly ended; `count === 0` ⇒ fall through to
  the quiet/fallback terminal. The authoritative drain's frame acks are
  independent of the count (data is committed either way).
- `lastNotificationAt` (guard record): written only on `showNotification`
  fulfillment. `lastNotificationAt < startedAt` ⇒ the last-resort fallback
  fires.

## State transitions

A push wake's terminal states, in priority order (see
[contracts/wake-outcomes.md](./contracts/wake-outcomes.md) for the full
per-kind table):

1. rich note(s) accepted (count > 0)
2. generic placeholder accepted
3. quiet note accepted
4. page claimed the wake → on trusted platforms: terminal; on unsafe
   platforms: quiet note (1 show) is the terminal
5. licensed silence — ONLY `mayEndWakeSilently(ua, clients)` (trusted
   platform + focused & visible client)
6. everything else → failure propagates → guardedPush fallback generic
