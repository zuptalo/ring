# Data Model: Unify in-app notifications/toasts + user-friendly "What's new"

**No data model.** This feature is entirely client-side presentation (how in-app
notifications/toasts render), release-note phrasing, and governance docs. There are no new
entities, no IndexedDB object stores, no DB migrations, and no client/server payload changes
(confirmed by the spec's "Key Entities — none" and "Zero-Knowledge Impact — none").

The only internal shape touched is the in-app banner descriptor `NotifyBanner` (in
`src/services/notify.ts`), which gains an optional `actions?` array and a persistent flag to
support the `'action'` kind — an in-memory UI type, not persisted data. Detailed in plan.md
§Design Overview.
