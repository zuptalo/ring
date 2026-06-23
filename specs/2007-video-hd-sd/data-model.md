# Phase 1 Data Model: HD/SD video sends are transcoded for real on device

**Spec**: [spec.md](./spec.md) · **Branch**: `fix/2007-video-hd-sd`

No new object stores, no `DB_VERSION` bump, no server schema/migration. This feature
reinterprets existing fields and adds no persisted shape. The conceptual core is the
distinction between **requested** and **achieved** quality.

## Entity: outgoing media Message (existing `Message`, `src/db/types.ts`)

| Field | Type | Meaning before | Meaning after |
|-------|------|----------------|---------------|
| `compressQuality` | `'sd' \| 'hd' \| undefined` | The tier to (re)compress at; drives resume. **Requested** tier. | Unchanged. Still the *requested* tier; drives whether the encode phase runs. |
| `mediaQuality` | `'sd' \| 'hd' \| 'original' \| undefined` | Set once at enqueue to the **requested** tier; drives the HD/SD/Original badge on both sides. | Set/overwritten after the encode phase to the **achieved** tier: `'sd'`/`'hd'` only if a real downscaled blob was produced, else `'original'`. |
| `mediaWidth` / `mediaHeight` | `number?` | Read from the uploaded blob. | Unchanged (already correct — they describe the delivered file). |
| `mediaSize` | `number?` | Byte size of the uploaded blob. | Unchanged (already correct). |

**Invariant introduced (FR-007 / FR-008)**: on a sent video/image,
`mediaQuality === 'sd' | 'hd'` **iff** the transmitted bytes were re-encoded to that
tier; otherwise `mediaQuality === 'original'`. `mediaWidth/Height/Size` always
describe the transmitted file and are mutually consistent with the label.

## Entity: MediaRef (existing, `src/services/crypto/message.ts`)

`MediaRef.quality` rides sealed in the message payload to the recipient
(`sealMediaAndEnqueue`, `queries.ts:1469`). After this change it carries the
**achieved** quality (because it is derived from the now-corrected
`message.mediaQuality`), so the recipient's badge is honest too. No shape change.

## Derived value: "achieved quality"

Pure helper (new, in `media-encode.ts`) used by both the chat job and the Posts path:

```
achievedQuality(requested, originalSize, uploadedBlob) →
  'original'  if requested is 'original' / undefined,
              or uploadedBlob is the original (size not reduced)
  requested   ('sd' | 'hd')  otherwise
```

Pure and unit-testable; no IndexedDB, no DOM. Single source of truth for the
labeling invariant so the chat path (`runMediaJob`) and Posts path (`createPost`)
can't drift.

## State transition (sender, video/image with a requested tier)

```
enqueue: status=compressing, compressQuality=<req>, mediaQuality=<req>(provisional)
  → encode phase: uploadBlob = compress(original, req)
  → mediaQuality = achievedQuality(req, original.size, uploadBlob)   ← new, honest
  → read meta from uploadBlob (width/height/size)  [already present]
  → seal MediaRef.quality = mediaQuality (achieved)  [already wired via the field]
  → upload → status=pending
```

`compressQuality` stays the *requested* tier so an interrupted job resumes and
re-attempts the requested transcode (rather than locking in a fallen-back result).
