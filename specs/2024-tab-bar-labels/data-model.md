# Data Model: Tab Bar Labels Stay Visible After Switching Tabs

**Spec**: [spec.md](./spec.md) · **Date**: 2026-07-10

No persistent data, no storage, no wire shapes. One piece of derived UI
state:

## ActiveTabMarker

- **Source**: `activeTab` computed from the current route
  (`/tabs/<name>` → `<name>`, fallback `chats`) — unchanged by this fix.
- **DOM projection (changed)**: a `data-on` attribute present on exactly the
  active tab's `ion-tab-button`, absent on the other four. Never a class.
- **Invariant**: at any settled moment exactly one of the five buttons
  carries `data-on`; all five buttons always retain their Ionic-managed
  classes (`md`/`ios`, `tab-has-label`, `tab-has-icon`,
  `tab-layout-icon-top`, `hydrated`) because nothing the app binds can
  rewrite `className`.
- **Consumers**: scoped CSS (`ion-tab-button[data-on] ion-icon` — circular
  tint + primary color) and the filled-vs-outline `:icon` swap (existing
  property binding, unchanged).
