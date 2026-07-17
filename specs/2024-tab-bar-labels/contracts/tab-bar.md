# Contract: Tab-Bar Observable Behavior

**Spec**: [spec.md](./spec.md) · **Date**: 2026-07-10

What any observer (user, e2e test, drive scenario) must see, at every settled
moment while the tab bar is visible:

| # | Observable | Requirement |
|---|-----------|-------------|
| 1 | Labels | All five tab buttons render their name (Calls, Chats, Wall, Contacts, Settings) with height > 0, after any number of tab switches |
| 2 | Active marker | Exactly one button carries the `data-on` attribute, matching the current `/tabs/<name>` route |
| 3 | Highlight | The `data-on` button's icon shows the circular primary-tint background and filled glyph; the other four show outline glyphs, no tint |
| 4 | Ionic classes | Every button retains its component-managed classes (mode, `tab-has-label`, `tab-has-icon`, layout, `hydrated`) forever |
| 5 | Badges | Unread badges keep rendering next to icon+label on their buttons |
| 6 | Navigation | Tab switches replace history (no back-stack growth); re-tapping the active tab is a no-op |
| 7 | Remount | After logout→login the bar returns fully intact (fresh components) |

Known accepted noise (FR-007, out of scope): one
`[ion-tabs] - Tab with id: "undefined" does not exist` console error per tab
tap.

The e2e regression asserts rows 1–3 after each click of a two-full-cycles tab
walk, plus row 6's re-tap no-op (active tab re-clicked → URL unchanged,
labels intact); history-replace in row 6 is pinned by the existing
e2e/navigation.spec.ts, and rows 4/5/7 are covered by rows 1–3's mechanics
plus code review.
