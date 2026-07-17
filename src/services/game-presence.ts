/**
 * "In this game right now" presence for fullscreen games (chess, Armada).
 *
 * Mirrors the typing indicator (spec 1009): an ephemeral, live-only, sealed
 * peer-to-peer signal that self-expires — never persisted, never pushed, and
 * the server sees only {t,to,from} (the game key + kind ride sealed). We reuse
 * that whole machinery via sendActivity with kind 'in-game', scoping it by the
 * game's SESSION KEY instead of a chat id so it means precisely "this peer has
 * THIS game's board open", not merely "online".
 *
 * While a board is open and the app is foregrounded we heartbeat `active` every
 * ~KEEPALIVE_MS; the opponent's entry auto-clears ~EXPIRY_MS after the last beat
 * (so a crash/close/background never leaves a stuck "in the game" dot). We also
 * send an explicit `stopped` the moment we leave or the tab is hidden, for a
 * snappy "they left" rather than waiting out the expiry.
 *
 * Reciprocity: sendActivity no-ops when the privacy.activityIndicators setting
 * is off (and applyActivity ignores inbound too) — so game presence follows the
 * same "you can't see what you won't share" gate as typing, with no new setting.
 */
import { sendActivity } from '@/composables/useSync';
import { ACTIVITY } from '@/services/transport';

interface Target {
  key: string;
  peer: string;
}

let current: Target | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let visBound = false;

function foreground(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

function beat(): void {
  if (!current || !foreground()) return;
  void sendActivity({ peerUserId: current.peer, conversationId: current.key, kind: 'in-game', state: 'active' });
}

function sendStopped(t: Target): void {
  void sendActivity({ peerUserId: t.peer, conversationId: t.key, kind: 'in-game', state: 'stopped' });
}

function onVisibility(): void {
  if (!current) return;
  if (foreground()) beat();
  else sendStopped(current); // hidden: tell the opponent we stepped away now
}

/**
 * Begin announcing that we're viewing game `sessionKey` to `opponentUserId`.
 * Idempotent for the same target; switching targets stops the previous one.
 */
export function startGamePresence(sessionKey: string, opponentUserId: string): void {
  if (!sessionKey || !opponentUserId) return;
  if (current && current.key === sessionKey && current.peer === opponentUserId) return;
  stopGamePresence();
  current = { key: sessionKey, peer: opponentUserId };
  if (!visBound && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
    visBound = true;
  }
  beat();
  timer = setInterval(beat, ACTIVITY.KEEPALIVE_MS);
}

/** Stop announcing presence and tell the opponent we've left (best-effort). */
export function stopGamePresence(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (visBound && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', onVisibility);
    visBound = false;
  }
  if (current) {
    sendStopped(current);
    current = null;
  }
}
