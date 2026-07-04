// The game catalog (spec 0008, FR-016/FR-017).
//
// Explicit registration — not glob auto-discovery — is deliberate: the one-line
// entry here is the human review point that guarantees every playable game is
// first-party code shipped inside the build. Games are NEVER downloaded or
// dynamically loaded; a "plugin" in Ring is a bundled module behind the
// GameModule interface, nothing more.
//
// Adding a game: create src/games/<id>/ (pure logic + module + board), add one
// line here and one line in boards.ts. Everything else — transport, storage,
// previews, notifications, the picker — is generic.

import type { GameModule } from './types'

export const GAMES: Record<string, GameModule> = {}
