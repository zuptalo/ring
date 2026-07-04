// Game id → board component map (spec 0008).
//
// This is the ONLY file under src/games/ allowed to import Vue components.
// The split keeps the rest of the directory pure (rules + session engine run
// in vitest and in queries.ts without touching SFCs); GameBubble.vue is the
// sole consumer of this map. A gameType missing here (older build seeing a
// future game) renders GameBubble's "update Ring to play" fallback.

import type { Component } from 'vue'
import TicTacToeBoard from './tictactoe/TicTacToeBoard.vue'

export const GAME_BOARDS: Record<string, Component> = {
  tictactoe: TicTacToeBoard,
}
