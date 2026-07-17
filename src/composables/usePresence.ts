/**
 * Reactive presence store (online / last-seen), fed by server-assisted presence
 * frames over the WebSocket relay.
 *
 * Presence is EPHEMERAL: it lives only in memory for the session, is never
 * persisted to IndexedDB and never synced. The server tracks each user's live
 * connections + a coarse last_seen, gated by that user's sharing booleans
 * (uploaded from their privacy settings), and pushes a `presence` frame to its
 * watchers (contacts) on every change. We subscribe to our contacts on connect
 * (see useSync) and merge updates here.
 *
 * Visibility: a peer who hides their online status reports online:false; a peer
 * who hides last-seen reports lastSeen:undefined. So `online:false` + no
 * lastSeen renders as nothing (unknown), which is exactly what we want.
 */
import { reactive, computed, type ComputedRef } from 'vue';
import type { PresenceFrame } from '@/services/transport';

export interface PeerPresence {
  online: boolean;
  lastSeen: number | null;
}

// Keyed by peer userId. reactive() so template reads stay live.
const presence = reactive(new Map<string, PeerPresence>());

/** Merge one inbound presence frame. */
export function applyPresenceFrame(f: PresenceFrame): void {
  if (!f.user) return;
  presence.set(f.user, {
    online: f.online === true,
    lastSeen: typeof f.lastSeen === 'number' && f.lastSeen > 0 ? f.lastSeen : null,
  });
}

/** Clear all presence (on sign-out / disconnect, so stale state isn't shown). */
export function clearPresence(): void {
  presence.clear();
}

/** Reactive accessor for one peer's presence (undefined until first heard). */
export function presenceFor(userId: string): ComputedRef<PeerPresence | undefined> {
  return computed(() => presence.get(userId));
}

/** Reactive plain read, call inside a computed/render to track the peer. */
export function peerPresence(userId: string): PeerPresence | undefined {
  return presence.get(userId);
}

/**
 * Human-friendly status line for a peer:
 *  - "Online" when online
 *  - "last seen …" when we have a timestamp
 *  - '' when unknown / hidden (render nothing)
 */
export function presenceLabel(p: PeerPresence | undefined): string {
  if (!p) return '';
  if (p.online) return 'Online';
  if (p.lastSeen) return `last seen ${relativeLastSeen(p.lastSeen)}`;
  return '';
}

/** Compact relative time for last-seen ("just now", "5m ago", "yesterday", …). */
export function relativeLastSeen(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  if (ts >= startOfToday.getTime()) {
    return `today at ${new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }
  if (ts >= startOfToday.getTime() - 86_400_000) {
    return `yesterday at ${new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }
  if (hr < 24 * 7) return new Date(ts).toLocaleDateString([], { weekday: 'long' });
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function usePresence() {
  return { presenceFor, presenceLabel, relativeLastSeen };
}
