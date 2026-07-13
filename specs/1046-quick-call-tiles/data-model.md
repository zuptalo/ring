# Data Model: spec 1046

## QuickCallEntry (value of the `calls.quick` setting — no new store)

```ts
export type QuickCallKind = 'audio' | 'video';
export interface QuickCallEntry {
  t: 'contact' | 'group';   // target type
  id: string;               // Contact.id | Chat.id (isGroup)
  kind: QuickCallKind;      // preferred method, shown on the tile
}
// setting `calls.quick`: QuickCallEntry[]  (ordered, insertion order, ≤ 8)
```

### Rules

| Rule | Where enforced |
|---|---|
| One entry per target (`t`+`id` unique); re-add = method update | `upsertEntry` (pure) |
| Soft cap: 8 entries | add picker (matches one clean tile row-pair) |
| `kind` must be within the target's allowed kinds | add picker, switch sheet, and re-checked at tap |
| Group call size = `chat.participantIds.length + 1` (self); contact size = 2 | `callSize` (pure) |
| video allowed iff size ≤ VIDEO_MAX (4); audio iff size ≤ AUDIO_MAX (8) | `allowedKinds` (pure) |
| Unknown target id → tile hidden; ghosted/blocked/over-cap → dimmed + reason | `entryVerdict` (pure) + render |

### Sync

`calls.quick` joins `SYNCED_PREF_KEYS`: it rides the sealed own-data settings
snapshot (client-side encrypted, whole-value LWW on the settings row) — the
same mechanism as `chats.tabFilters`. Nothing new crosses the wire in
plaintext.

## Per-kind call statistics (display-only, not persisted)

`computeCallTotals(callsSinceResetAt)` → `{audioMinutes, videoMinutes,
audioBytes, videoBytes, combinedBytes}` rendered on NetworkUsagePage; the
window is the existing `network.resetAt` setting.
