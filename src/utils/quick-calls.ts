/**
 * Quick Call entries (spec 1046): the pure logic behind the Calls tab's
 * one-tap call tiles. Dependency-free apart from the shared capacity constants
 * (like chat-pins/ownsync-keys, so the data layer, the UI, and unit tests all
 * consume the same rules). The list itself lives in the synced `calls.quick`
 * setting (see ownsync-keys); everything here is derivation, no I/O.
 *
 * The invariant that matters (SC-002/003): a tap must either ring or explain —
 * so the SAME verdict logic runs at add time, at method-switch time, and again
 * at tap time (groups grow after an entry is created).
 */
import { VIDEO_MAX, AUDIO_MAX } from '@/services/call/types';

export type QuickCallKind = 'audio' | 'video';
export interface QuickCallEntry {
  /** Target type: a contact (person call) or a group chat (group call). */
  t: 'contact' | 'group';
  /** Contact.id or the group Chat.id. */
  id: string;
  /** Preferred method, shown on the tile and used by the tap. */
  kind: QuickCallKind;
}

/** Soft cap on entries — two clean tile rows, mirroring the 9-pin grid's restraint. */
export const QUICK_CALLS_MAX = 8;

/** The settings-ledger key the list lives under (synced via SYNCED_PREF_KEYS). */
export const QUICK_CALLS_KEY = 'calls.quick';

/** The slice of Contact/Chat these helpers need (structural, keeps tests tiny). */
export interface QuickCallTarget {
  id: string;
  isGroup?: boolean;
  participantIds?: string[];
  ghosted?: boolean;
  blocked?: boolean;
}

/** How many people the entry's call would hold — the target plus me (a group's
 *  participantIds excludes self; a 1:1 call is always two). */
export function callSize(entry: QuickCallEntry, target: QuickCallTarget): number {
  if (entry.t === 'group') return (target.participantIds?.length ?? 0) + 1;
  return 2;
}

/** Which methods a call of `size` people may use (FR-004: video ≤ 4, audio ≤ 8). */
export function allowedKinds(size: number): QuickCallKind[] {
  const kinds: QuickCallKind[] = [];
  if (size <= AUDIO_MAX) kinds.push('audio');
  if (size <= VIDEO_MAX) kinds.push('video');
  // Present as [audio, video] for stable UI ordering.
  return kinds.sort();
}

/** Add-or-update (FR-007): one entry per target; re-adding updates the method
 *  in place. New targets append (insertion order) but never past the soft cap. */
export function upsertEntry(list: QuickCallEntry[], entry: QuickCallEntry): QuickCallEntry[] {
  const at = list.findIndex((e) => e.t === entry.t && e.id === entry.id);
  if (at >= 0) {
    const next = [...list];
    next[at] = { ...entry };
    return next;
  }
  if (list.length >= QUICK_CALLS_MAX) return [...list];
  return [...list, { ...entry }];
}

/** Remove by target. */
export function removeEntry(list: QuickCallEntry[], entry: Pick<QuickCallEntry, 't' | 'id'>): QuickCallEntry[] {
  return list.filter((e) => !(e.t === entry.t && e.id === entry.id));
}

export type QuickCallVerdict =
  | { ok: true }
  | {
      ok: false;
      /** missing = target unknown on this device; over-cap = the group outgrew
       *  the entry's kind; ghosted/blocked = the contact can't be called. */
      code: 'missing' | 'ghosted' | 'blocked' | 'over-cap';
      reason: string;
      /** For over-cap: the kinds the target's CURRENT size still allows. */
      allowed?: QuickCallKind[];
    };

/** Can this entry ring right now? Run before rendering the tile as healthy and
 *  again on tap. The capacity phrasing matches call/capacity.ts so limits speak
 *  with one voice everywhere. */
export function entryVerdict(entry: QuickCallEntry, target: QuickCallTarget | undefined): QuickCallVerdict {
  if (!target) return { ok: false, code: 'missing', reason: 'This contact or group is no longer available' };
  if (entry.t === 'contact') {
    if (target.ghosted) return { ok: false, code: 'ghosted', reason: 'This account no longer exists' };
    if (target.blocked) return { ok: false, code: 'blocked', reason: 'You have blocked this contact' };
  }
  const size = callSize(entry, target);
  const allowed = allowedKinds(size);
  if (!allowed.includes(entry.kind)) {
    const reason =
      entry.kind === 'video'
        ? `Video calls are limited to ${VIDEO_MAX} people`
        : `Audio calls are limited to ${AUDIO_MAX} people`;
    return { ok: false, code: 'over-cap', reason, allowed };
  }
  return { ok: true };
}

/** Sanitise the synced setting value: it may come from another build (older,
 *  newer, or hand-edited), so garbage rows drop instead of crashing the tab,
 *  and duplicate targets keep their first occurrence. */
export function parseQuickCalls(raw: unknown): QuickCallEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: QuickCallEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const { t, id, kind } = row as Record<string, unknown>;
    if ((t !== 'contact' && t !== 'group') || typeof id !== 'string') continue;
    if (kind !== 'audio' && kind !== 'video') continue;
    const key = `${t}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ t, id, kind });
  }
  return out;
}
