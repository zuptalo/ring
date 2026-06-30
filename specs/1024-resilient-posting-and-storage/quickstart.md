# Quickstart — Resilient posting & storage

How to exercise and verify the feature once implemented.

## Gates

```sh
npm run build            # vue-tsc typecheck + vite build (client gate)
npx vitest run           # unit: outbox queries, per-item confirm, storage estimate
npm run test:e2e         # e2e/resilient-posting.spec.ts (needs `make db-up`)
cd server && go test ./...   # expected no-op (no server change)
```

## Manual walkthrough (drive harness on the live dev stack)

1. `make start`, then in the composer pick 2–3 photos/a video + (optionally) record a voice clip.
2. **Tap Share** → the composer closes *immediately*; a **pending card with a progress bar** sits at
   the top of the Wall. Scroll / switch tabs — it keeps uploading. *(SC-001, FR-001/002)*
3. Wait → the card becomes a normal post; its "disappears in…" countdown starts **now**, not from
   when you tapped Share. *(FR-004/SC-003)*
4. **Resume:** start another share, then kill the app mid-upload (close the tab / force-quit the
   PWA). Reopen → it **auto-resumes and finishes**; if you simulate a persistent failure, the card
   shows **Retry / Cancel**. Retry re-sends only the unconfirmed items. *(FR-005/013/014)*
5. **Source removal:** after Share, delete the source photo from the device → the post still
   completes (we uploaded our cached copy). *(FR-007)*
6. **Storage guard:** with low free space, try to select a large batch → an up-front warning
   ("free up space and try again") and no encode starts. *(FR-009/SC-004)*
7. **Cleanup:** after a post finalizes (or you Cancel), confirm IndexedDB has no leftover `outbox`
   row or cached blob. *(FR-008/SC-006)*

## Chat parity

Repeat steps 1–5 sending media in a chat (not the Wall): the pending media message renders in the
thread and resumes the same way. *(FR-012)*

## Zero-knowledge spot-check

In devtools → Network, confirm uploads carry only **ciphertext + opaque blob ids** (no plaintext
media, caption, or recipient identity). The cached `outbox` blobs exist only in local IndexedDB and
vanish on finalize/cancel.
