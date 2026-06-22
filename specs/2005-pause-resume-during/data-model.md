# Data Model: Pause/resume during video-message recording

**No data model.** This is a client-side recorder UI fix — no new entities, no IndexedDB
object stores, no DB migrations, and no client/server payload changes (confirmed by the
spec's "Key Entities — none" and "Zero-Knowledge Impact — none").

The only state touched is the in-component recorder state in `VideoNoteRecorder.vue`: a
`paused` flag plus the recorded-time accounting (`accumMs`, `segStartMs`) replacing the
current `startMs` — in-memory UI state, not persisted data. Detailed in plan.md §Design
Overview. The extracted `recordedMs(...)` helper is a pure function over that state, not a
stored shape.
