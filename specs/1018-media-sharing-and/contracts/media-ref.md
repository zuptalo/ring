# Contracts: Media Sharing & Viewer Improvements

This feature is **client-only**. There is **no new or changed external interface**:

- **No new HTTP endpoint** and **no change to any `/v1/*` handler.** The server continues to relay
  opaque ciphertext and store blobs by capability-style id.
- **No SQL migration**, no `DB_VERSION` bump.
- **No wire-schema change.** The only client↔client interface touched is the sealed `MediaRef`, and
  its **shape is unchanged** — only the byte size/quality of an existing field changes.

## Relevant existing interface (unchanged shape) — sealed `MediaRef`

Defined at `src/services/crypto/message.ts:18-30`, carried inside the ratchet-encrypted
`MessagePayload.mediaRef`:

```ts
interface MediaRef {
  // capability/id + decryption material for the uploaded ciphertext blob (unchanged)
  // ...
  poster?: string;  // data-URL JPEG thumbnail — INSIDE the sealed payload.
                    // 1018: generated at ~512px / ≤~40KB (was 480/400 @ lower quality).
                    // Field name, type, and position unchanged → wire-compatible both ways.
  width?: number;   // 1018: MUST be the DISPLAY (post-rotation) width for video
  height?: number;  // 1018: MUST be the DISPLAY (post-rotation) height for video
}
```

### Compatibility contract

- **Backward:** a 1018 client reading a pre-1018 message renders its old low-res `poster` and its
  `width/height` exactly as today (FR-008). No field added or removed.
- **Forward:** a pre-1018 client reading a 1018 message sees a larger/crisper `poster` in the same
  field and oriented `width/height`; it renders normally (it never depended on a specific poster size).
- **Orientation:** because the re-encoded video bytes are baked upright (not metadata-rotated), even a
  recipient player that ignores display matrices shows the video correctly.

## Zero-Knowledge note

`poster` remains entirely within the encrypted `MessagePayload`; the server never receives a plaintext
thumbnail or media bytes. Raising poster quality changes ciphertext length only — not its readability.
See `research.md` → "Zero-Knowledge Impact".
