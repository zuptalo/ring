/**
 * Push routing prefs derivation (spec 1050) — the recipient half of the
 * routing model. PURE: snapshots in, the server's prefs blob out, so the
 * hidden-chat exclusion (FR-008c / SC-011) is a plain unit-tested filter and
 * nothing here can touch IndexedDB or the network. push.ts feeds it and PUTs
 * the result (full-state replace, FR-011) on subscription upsert and whenever
 * an input changes.
 *
 * Coarseness is deliberate and documented (spec edge cases): a class opts out
 * only when EVERY toggle it covers is off — mixed settings keep pushes on and
 * the device keeps filtering rendering exactly as in spec 1048.
 */

export interface PrefsChatSnap {
  id: string;
  prid?: string;
  mutedUntil?: number;
  notifyWebPush?: boolean;
}

export interface PrefsInput {
  /** Raw settings key→value; absent key = its default (= that toggle is ON). */
  settings: Record<string, unknown>;
  chats: PrefsChatSnap[];
  /** Hidden chat ids — structurally excluded from everything (FR-008c). */
  hiddenIds: Set<string>;
  /** Wall per-person prefs: muted authors, and the per-friend always-alert list. */
  wall: { muted: string[]; always: string[] };
  now: number;
}

export interface PushPrefs {
  classesOff: string[];
  mutedPrids: string[];
  postSenders: { muted: string[]; always: string[] };
}

/** A toggle is off only when it is EXPLICITLY false (defaults are all on). */
function off(settings: Record<string, unknown>, key: string): boolean {
  return settings[key] === false;
}

export function derivePushPrefs(i: PrefsInput): PushPrefs {
  const classesOff: string[] = [];
  if (off(i.settings, 'notifications.message.reactions') && off(i.settings, 'notifications.group.reactions')) {
    classesOff.push('reaction');
  }
  if (
    off(i.settings, 'notifications.games.turn') &&
    off(i.settings, 'notifications.games.challenges') &&
    off(i.settings, 'notifications.games.followMoves') &&
    off(i.settings, 'notifications.games.followResults')
  ) {
    classesOff.push('game');
  }
  if (off(i.settings, 'notifications.wall.show')) classesOff.push('post');
  if (off(i.settings, 'notifications.wall.activity')) classesOff.push('activity');
  // The global master silences ordinary messages AND personally-directed ones —
  // with it off the user asked for quiet, full stop (mentions included).
  if (off(i.settings, 'notifications.message.show')) classesOff.push('message', 'mention');

  const mutedPrids: string[] = [];
  for (const c of i.chats) {
    if (!c.prid) continue; // pre-convergence conversation: nothing to register yet
    if (i.hiddenIds.has(c.id)) continue; // FR-008c: hidden chats are structurally absent
    const muted = (c.mutedUntil !== undefined && c.mutedUntil > i.now) || c.notifyWebPush === false;
    if (muted) mutedPrids.push(c.prid);
  }

  return {
    classesOff,
    mutedPrids,
    postSenders: { muted: [...i.wall.muted], always: [...i.wall.always] },
  };
}
