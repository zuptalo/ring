# Contract: Game payload inside the sealed message envelope

**Spec**: [../spec.md](../spec.md) | **Date**: 2026-07-05

This is the feature's only externally-observable interface — "external" meaning *the
other participant's device*, since the server never parses any of it (Principle I). It
must stay backward- and forward-compatible across app versions once shipped.

## Envelope position

Both structures are optional fields on the existing plaintext `MessagePayload`
(`src/services/crypto/message.ts`), JSON-serialized and sealed by the existing
`sealMessage` / opened by `openMessage`. They ride the opaque `msg` WS frame. **No server
component parses, stores, or routes on any field below.**

## 1. Game start (visible message)

A normal message whose `kind` is `'game'` and which carries:

```jsonc
// MessagePayload additions
{
  "kind": "game",
  "game": {
    "gameType": "tictactoe",    // GameModule.id from the registry; immutable wire id
    "theme": "space"            // optional visual theme id from the game's bundled
                                // theme list (FR-022); frozen once shipped; an
                                // unknown/absent theme renders as 'classic'
  }
}
```

Semantics:
- Creates a session anchored to this message's id. Sender = player 0 and moves first.
- Initial board state is NOT transmitted — both ends derive it from the module's
  `createInitialState()`. There is no accept step; the bubble is immediately playable.
- Unknown `gameType` (older app or future game): render a fallback bubble ("Game —
  update Ring to play"); never crash, never corrupt the chat.

## 2. Game move / resign (side-effect signal, no visible message)

```jsonc
// MessagePayload additions
{
  "gameMove": {
    "messageId": "<game bubble id>",  // sender-side id; receiver resolves via remoteId
    "seq": 3,                          // 1-based, strictly increasing per session
    "action": "move",                 // or "resign" (then "move" field is absent)
    "move": { "cell": 4 },            // game-specific move shape (tictactoe: cell 0-8)
    "at": 1751712000000                // sender clock, display only
  }
}
```

Semantics (receiver MUST):
- Validate per the session-engine rules in [../data-model.md](../data-model.md)
  (existence → terminal → duplicate → conflict → gap → turn → legality).
- Apply exactly once (duplicate `seq` + identical content = silent drop).
- On any validation failure other than duplicate/expired-target: mark the session
  out-of-sync (terminal); never partially apply.
- Never trust derived state from the peer — the wire carries *moves*, boards are always
  local replays.

## 3. Compatibility rules

- Both fields are additive and optional: pre-feature clients ignore `gameMove` and show
  the standard unknown-kind fallback for `kind: 'game'`.
- `gameType` ids and each game's `move` shape are frozen once shipped; evolving a game's
  rules requires a NEW `gameType` id (e.g. `'tictactoe2'`), never a silent change —
  otherwise mixed-version replay diverges.
- New actions beyond `move`/`resign` (e.g. a future draw offer) must be ignorable by
  older clients without corrupting the session: unknown `action` → drop the signal,
  do NOT mark out-of-sync.

## 4. Internal interface: GameModule (bundled plugins)

Not a wire contract, but the extension contract FR-016 promises — kept here so game
authors have one page to read:

```ts
interface GameModule<S = unknown, M = unknown> {
  id: string;                  // wire id, immutable once shipped
  displayName: string;
  icon: string;                // Ionicon name
  players: 2;
  createInitialState(): S;
  applyMove(state: S, move: M, player: 0 | 1): S | null;  // null = illegal; MUST NOT throw
  turn(state: S): 0 | 1;
  status(state: S): { state: 'ongoing' | 'won' | 'draw'; winner?: 0 | 1 };
}
```

Adding a game = one new `src/games/<id>/` directory implementing this + one registration
line in `src/games/registry.ts` + one board-component line in `src/games/boards.ts`.
Everything else (transport, storage, previews, notifications, picker listing) is generic.
`applyMove`/`status`/`turn` MUST be pure and deterministic — replay depends on it.
