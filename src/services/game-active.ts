// Which fullscreen GAME is on screen (spec 1038 FR-007) — the exact mirror of
// notify.ts's active-chat rule: while a game's overlay is open, THAT game's
// own move/turn/result banners are suppressed (the player watches the board
// live), while everything else — other chats, other games, requests — still
// banners over the game. The key is the session's carrying id (message id in
// a chat, post id on the wall) — the same ids the game notification
// classifiers already hold.
//
// A standalone module (not notify.ts) for the same reason game-sounds.ts is:
// notify.ts drags the router (and therefore SFCs) into any importer, which
// keeps this primitive out of unit tests and would cycle from queries.ts.

let activeGameKey: string | null = null;

/** Set by useGameOverlay on open; cleared on minimize/close. */
export function setActiveGame(key: string | null): void {
  activeGameKey = key;
}

/** True when the user is actively watching this game's fullscreen overlay.
 *  Page-side only (the overlay is the only setter); when a document exists it
 *  must actually be visible — a hidden tab is not "watching". */
export function isGameActive(key: string): boolean {
  if (activeGameKey !== key) return false;
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}
