# Phase 0 — Research & Decisions: Resilient posting & storage

All open questions resolved; no `NEEDS CLARIFICATION` remain.

## D1 — "Backend confirmation" signal (no new server API)

- **Decision**: Treat the **existing** responses as confirmation. `uploadBlob()` returning a blob id
  = that item is confirmed-stored; `createPost()` (the sealed envelope POST) succeeding = the post
  is "made". Track a per-item `blobId`/`confirmed` flag in the outbox; the post finalizes when every
  item has a blob id **and** the envelope POST returns 2xx.
- **Rationale**: The server already persists blobs + envelopes durably; its success responses are an
  authoritative receipt. Adding a bespoke "confirm" endpoint would duplicate that and touch the
  zero-knowledge server for no benefit (Principle VI).
- **Alternatives**: A new `/v1/posts/{id}/ack` endpoint (rejected — server change, no added safety);
  optimistic local "made" without server ack (rejected — violates FR-004 / SC-003).

## D2 — `createdAt` / disappear-timer start

- **Decision**: The client stamps `createdAt = now()` at the moment `createPost()` succeeds (not at
  Share), and derives `expiresAt = createdAt + lifetime` then. The server stores those as today.
- **Rationale**: Satisfies FR-004 / SC-003 with zero server change; the client already owns these
  fields on the envelope.
- **Alternatives**: Server-assigned timestamp (rejected — needs the server to return it; current
  envelope is client-timestamped, and clock authority isn't worth a protocol change here).

## D3 — Outbox persistence + cached working blobs

- **Decision**: New IndexedDB `outbox` object store (keyPath `id`) holding the pending record + an
  array of items, **each with its own `Blob`** (a copy taken at Share). `DB_VERSION` bumps and
  `onupgradeneeded` creates the store. Writes go through the existing change-bus.
- **Rationale**: IndexedDB is the offline-first source of truth (Principle V); caching our own blob
  copies makes the upload independent of the source file (FR-007) and survives app restart (FR-005).
- **Alternatives**: Hold `File`/source references only (rejected — invalid after the picker closes /
  source removed); OPFS (rejected — IndexedDB already used everywhere + has the change-bus).

## D4 — Zero-knowledge at-rest treatment of cached blobs

- **Decision**: Store cached working blobs **as plaintext locally**, identical to the existing
  `media` store. They are deleted on finalize/cancel (FR-008). Only sealed ciphertext is uploaded.
- **Rationale**: Consistent with the shipped at-rest model (device encryption + PIN-lock gate the
  app; media blobs aren't separately AEAD-wrapped). No new plaintext crosses the wire → ZK intact.
  Captured in the spec's Zero-Knowledge Impact section and re-verified by `/speckit-checklist`.
- **Alternatives**: AEAD-wrap each cached blob under the PIN key (rejected for v1 — inconsistent with
  the existing media store, adds encode/decode cost on a transient artifact; revisit only if the
  checklist flags a gap for *both* stores).

## D5 — Upload worker model (resume + auto-retry once)

- **Decision**: A single in-app worker (`services/outbox.ts`) that drains the outbox sequentially.
  Triggered on: (a) enqueue, (b) app start / keystore unlock, (c) the `online` event / reconnect.
  On app start it **auto-retries each interrupted item once** (FR-013); a still-failing post flips to
  `failed` and surfaces Retry/Cancel. A manual Retry re-drains, re-sending only unconfirmed items
  (FR-014). One in-flight post at a time (queue), so progress + bandwidth stay predictable.
- **Rationale**: Mirrors the existing `useSync` reconnect/drain pattern; no service-worker upload
  queue (out of scope — see spec) keeps it simple and within the offline-first model.
- **Alternatives**: A Web Worker / SW background-fetch upload queue (rejected for v1 — complexity +
  iOS PWA limitations; resume-on-open covers the requirement).

## D6 — Storage-estimate guard + headroom factor

- **Decision**: At media selection (composer + chat picker), call `navigator.storage.estimate()` and
  compare `quota − usage` against `Σ(selected bytes) × HEADROOM`. **`HEADROOM = 2.5`** (encode temp +
  encoded output + margin) with a **minimum floor of 50 MB**. If it won't fit, show an up-front
  warning (free space + retry) and do not begin encoding. Where `storage.estimate` is unavailable,
  degrade to a no-op (never block sharing).
- **Rationale**: Video transcode roughly needs input + temp + output; 2.5× is a safe envelope, the
  floor avoids false positives on small selections. Best-effort per FR-009 / SC-004.
- **Alternatives**: Per-codec exact projection (rejected — over-engineered, the estimate is
  inherently approximate); hard-block with no estimate (rejected — would wrongly stop sharing on
  browsers lacking the API).

## D7 — Pending UI integration

- **Decision**: `useOutbox` exposes a reactive pending list via `useLiveQuery('outbox')`. `useWall`
  prepends pending Wall posts to the feed; `ChatDetailPage` renders a pending media message inline.
  Each shows `ion-progress-bar` + per-item state, and (when `failed`) Retry/Cancel `ion-button`s.
- **Rationale**: Reuses the established live-query reactivity (Principle V) and stock Ionic (XI).
- **Alternatives**: A separate "Outbox" screen (rejected — the spec wants pending items *in place*).
