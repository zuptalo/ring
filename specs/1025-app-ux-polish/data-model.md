# Phase 1 Data Model: App-wide UX polish and fixes

No new IndexedDB object store and no `DB_VERSION` bump. This feature reads existing records and adds
one derived, in-memory view (Calls totals). Settings changes remove keys; they do not add stored
data.

## Existing entities (read-only here)

### Call (`src/db/types.ts`)

- `kind`: `'audio' | 'video'`
- `durationSec`: number — call length in seconds
- `bytes?`: number — total data sent + received over the call (may be absent for old/interrupted calls)
- `timestamp`: number — used for the ISO `YYYY-MM-DD` date display
- (other fields unchanged)

Used by: US6 (FR-015 date format, FR-017 totals).

### Media (`src/db/types.ts`)

- `blob?`: full-resolution original (may be freed)
- `posterBlob?`: large poster tier (~512px) — the viewer should use this for video
- `posterGrid?`: 320px tier (all-media grid)
- `posterStrip?`: 128px tier (bottom thumbnail strip)

Used by: US4 (FR-010..012 correct tier per context).

## Derived view (new, in-memory only)

### CallTotals

Computed on-device from the visible `Call` records; not persisted.

- `audioMinutes`: number — sum of `durationSec` for `kind==='audio'`, expressed in minutes
- `videoMinutes`: number — sum of `durationSec` for `kind==='video'`, in minutes
- `audioBytes`: number — sum of `bytes` for audio calls (missing bytes count as 0)
- `videoBytes`: number — sum of `bytes` for video calls
- `combinedBytes`: number — `audioBytes + videoBytes`

Rules:
- A call missing `bytes` contributes 0 to the data totals but still contributes `durationSec` to minutes.
- Zero-duration calls contribute 0 minutes.
- Totals are computed from the same call set the Calls list shows (no server fetch).

## Settings keys touched

- Removed entry point: one of the two `Animations` links (`chats-animations`) — no key change, the
  screen and its keys (`chats.animEmoji`, `chats.animGifs`) stay.
- `chats.animGifs`: now actually consumed by the autoplay-visible directive (previously inert).
- Removed toggle: `notifications.inapp.vibrate` (and its now-unused pref in `notify.ts`).
- `notifications.showPreview`: behavior widened to also genericize the notification title when off.
- Help `Version` stat: value changes from a hardcoded string to `__APP_VERSION__` (no stored data).

No zero-knowledge impact: all of the above is device-local; nothing new is sent to or stored on the server.
