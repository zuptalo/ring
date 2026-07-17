// Game audio (spec 0008 FR-026), riding the synthesized cue system in
// sound.ts (no audio files). The DECISION of which cue an event earns is a
// pure function so the local and inbound paths sound identical; the PLAYER
// applies the "Game sounds" toggle. The chat-must-be-open rule lives at the
// call sites in queries.ts (they know the chat), and notification sounds
// cover everything that happens while the chat is closed — so a game event
// never sounds twice.
//
// Reads the setting via the idb wrapper directly (NOT db/queries.getSetting)
// to keep the dependency one-directional: queries.ts imports this module.

import { get } from '@/db/idb'
import { cue, type ToneName } from '@/services/sound'
import type { GameSessionStatus } from '@/games/types'

export type GameCue =
  | 'gamestart'
  | 'gamemove'
  | 'gamewin'
  | 'gamelose'
  | 'gamedraw'
  | 'gamechallenge'
  | 'gameaccept'
  | 'bs-fire'
  | 'bs-splash'
  | 'bs-hit'
  | 'bs-sunk'
  | 'bs-sonar'
  // Armada's naval foley + its own victory march / defeat lament (spec 1038).
  | 'ar-fire'
  | 'ar-splash'
  | 'ar-hit'
  | 'ar-sunk'
  | 'ar-sonar'
  | 'ar-victory'
  | 'ar-defeat'

/** The cue a game's new status earns for the player `me` — null for silence
 *  (out of sync is a failure state, not a moment; FR-026). */
export function gameCueFor(status: GameSessionStatus, me: 0 | 1): GameCue | null {
  switch (status.state) {
    case 'ongoing':
      return 'gamemove'
    case 'won':
    case 'resigned':
      return status.winner === me ? 'gamewin' : 'gamelose'
    case 'draw':
      return 'gamedraw'
    default:
      return null
  }
}

/** Play a game cue behind the "Game sounds" toggle (default on). Rate limiting
 *  and the e2e cue recorder come with sound.ts's cue(). */
export async function playGameCue(name: GameCue | null): Promise<void> {
  if (!name) return
  const setting = await get<{ key: string; value: boolean }>('settings', 'notifications.gameSounds')
  if (setting && setting.value === false) return
  cue(name as ToneName)
}
