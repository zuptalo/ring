# Feature Specification: Game Challenges in Groups and on the Wall

**Feature Branch**: `feat/0009-game-challenges-groups`

**Created**: 2026-07-05

**Status**: planned
<!-- Ring spec lifecycle: planned → in-progress → in-review → shipped.
     This line is the source of truth for the spec's row in ROADMAP.md;
     bump it as the work moves through the pipeline. The spec id and category
     are derived from the directory number (0001+ planned, 1001+ ad-hoc,
     2001+ hotfix), so do not restate them by hand. -->

**Input**: User description: "For group chats and the Wall, let a user start a game which invites others to a challenge. The first to accept the challenge becomes the other player in the game and the rest can observe their play. Only the players are notified about their turns; others are quiet observers unless they tap Follow on a game to receive updates on each player's move and the final result. The visibility of games played on the Wall is limited to the audience selected at creation time by the creator. A fun and inviting animation announces a new challenge. Game notification behavior should be customizable in Settings → Notifications."

**Depends on**: spec 0008 (the in-chat game platform: plugin registry, session engine, themes, bubble UI, sounds, animated design language).

## Clarifications

### Session 2026-07-05

- Q: After someone accepts a Wall challenge, where does the game live? → A: On the post — the post itself becomes the live board for the whole audience; moves ride the Wall's sealed engagement channel and observers see updates when their Wall refreshes.
- Q: Should an unaccepted group challenge expire on its own? → A: No — it stays open until the creator withdraws it or someone accepts (cancel only).
- Q: What does Play again do after a group game ends? → A: It throws a FRESH open challenge to the whole group; anyone can take the next round.
- Q: How do Wall players and followers learn about moves while the app is closed? → A: The content-free Wall push fans to the WHOLE audience for game engagement (today it wakes only the post author); each device decides locally, from its own turn/follow settings, whether to show anything. The server learns only that a post has game activity, which the engagement kind string already tells it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Throw down a challenge in a group chat (Priority: P1)

A member of a group chat starts a game from the attach menu, picking the game and a theme as in a 1:1 chat. Instead of a board, the group first sees an inviting, animated challenge bubble: "{Name} challenges the group to Tic-tac-toe — who's in?" with an Accept action. The first member to accept becomes the opponent; the bubble turns into the live board showing the matchup, and the two players alternate exactly like a 1:1 game. Everyone else sees the board update as moves land, quietly.

**Why this priority**: This is the core social loop — a challenge, a taker, and an audience — and everything else builds on it.

**Independent Test**: In a three-member group, A starts a challenge; B accepts; C watches. A and B play to a win; all three devices show the identical challenge → game → result progression, and C never gets a notification.

**Acceptance Scenarios**:

1. **Given** an open group chat, **When** a member starts a game from the attach menu, **Then** an animated challenge bubble appears for every member, showing who challenges, which game and theme, and an Accept action.
2. **Given** an open challenge, **When** the first member accepts, **Then** on every device that member becomes the opponent, the bubble becomes the playable board, and the matchup shows both players' names and marks.
3. **Given** two members accept in a race (e.g. across an offline gap), **When** their accepts both arrive, **Then** every device converges on the SAME opponent deterministically, and the other accepter becomes an observer with a brief explanation.
4. **Given** an active group game, **When** a non-player taps a board cell, **Then** nothing happens — only the two players can move.
5. **Given** the challenge creator, **When** they try to accept their own challenge, **Then** nothing happens.
6. **Given** an accepted game, **When** the players play to a result, **Then** the result overlay (trophy/medal/handshake) appears for players AND observers.

---

### User Story 2 - Quiet observers, loud when they choose (Priority: P2)

Group members who aren't playing see the game evolve in the chat but receive no notifications about it. Any observer can tap Follow on a game bubble to get updates — each move and the final result — and tap again to unfollow. Players never need Follow: their turn notifications are built in.

**Why this priority**: The quiet-by-default rule is what keeps group games from becoming notification spam; Follow is the opt-in for the invested.

**Independent Test**: In a three-member group with an active game, C receives no game notifications; C taps Follow and starts receiving a notification per move plus the result; C unfollows and goes quiet again. Only the player whose turn it is gets a "your move" notification.

**Acceptance Scenarios**:

1. **Given** an active group game, **When** a move lands, **Then** ONLY the player whose turn it now is gets a turn notification; observers get nothing.
2. **Given** an observer who tapped Follow on a game, **When** a move lands or the game ends, **Then** they are notified who moved (or who won), subject to the chat's existing mute/privacy gates.
3. **Given** a follower, **When** they tap Unfollow, **Then** the updates stop; following is private to their device (nobody learns who follows).
4. **Given** a new challenge in the group, **When** it appears, **Then** every member gets a normal message notification for the challenge itself (it is a message), gated as usual.

---

### User Story 3 - Challenges on the Wall (Priority: P3)

A user shares a game challenge as a Wall post, choosing the audience (friends or close friends) exactly like any post. Anyone in that audience can be the first to accept and becomes the opponent; the rest of the audience are the observers. The game's visibility is limited to that audience for its whole life.

**Why this priority**: Extends the challenge loop beyond a single group to the poster's chosen circle; depends on the group mechanics landing first.

**Acceptance Scenarios**:

1. **Given** the Wall composer, **When** the user creates a game-challenge post with an audience, **Then** exactly that audience sees the animated challenge on their Wall feed.
2. **Given** a Wall challenge, **When** the first audience member accepts, **Then** the whole audience sees who took it and the game begins, with the matchup named.
3. **Given** an active Wall game, **When** a move lands, **Then** the audience's devices are woken by a content-free push and each decides locally: the player whose turn it is and followers get alerts; everyone else stays quiet. Opening the Wall always shows the current board.
4. **Given** the post's lifetime expires (like any post), **Then** the challenge/game disappears with it for everyone.

---

### Edge Cases

- **Accept race**: two accepts for the same challenge → deterministic convergence on one opponent everywhere (earliest accept time wins, stable tie-break); the loser of the race sees "{Name} got there first".
- **Nobody accepts**: the challenge stays open; the creator can cancel it (the bubble becomes "Challenge withdrawn"); challenges never auto-expire in groups (a Wall challenge is bounded by its post lifetime).
- **A player leaves the group mid-game**: the game ends as a resignation by the leaver.
- **Rematch in groups**: Play again throws a fresh OPEN challenge to the whole group (never a locked rematch), keeping every round first-to-accept.
- **Old app versions**: members on a pre-0009 app see the challenge as an unknown message kind (standard fallback); they cannot accept or observe until they update. Never a crash.
- **One game per chat**: the existing gate applies per group chat — one ongoing challenge-or-game at a time.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A group-chat member MUST be able to start an open game challenge (game + theme) from the attach menu; it renders for every member as an animated, inviting challenge bubble naming the challenger, game, and theme, with an Accept action and an animated cue drawn from the design palette (docs/ANIMATED-EMOJI.md).
- **FR-002**: The FIRST member to accept becomes the opponent, on every device identically: accept races MUST resolve deterministically from the accepts' own timestamps (stable tie-break), never by local arrival order.
- **FR-003**: Once accepted, the game plays with exactly the spec-0008 mechanics (validated move log, turn alternation, themes, result overlay, player sound cues) between the challenger (player 0) and the acceptor (player 1); all other members' devices render the same board read-only.
- **FR-004**: The creator MUST be able to cancel an unaccepted challenge; the bubble shows it was withdrawn.
- **FR-005**: Turn notifications go ONLY to the player whose move it is. Observers receive no game-move notifications by default. The challenge itself notifies like a normal group message.
- **FR-006**: Any observer MUST be able to Follow / Unfollow a specific game from its bubble; followers are notified of each accepted move (who moved) and the final result (who won). Following is device-local and private — no one, including the players and the server, learns who follows (zero-knowledge: no new wire data).
- **FR-007**: All challenge/accept/move/cancel signals ride the existing sealed message channels (group sender keys); the server gains no new capability, endpoint, or visible structure. Zero server changes for the group story.
- **FR-008**: A Wall user MUST be able to post a game challenge with the standard post audience selection; only that audience can see, accept, follow, or observe the game, and the post's standard lifetime bounds the whole game.
- **FR-009**: Game notification behavior MUST be customizable under Settings → Notifications → Games: your-turn alerts, new-challenge alerts, followed-game moves, and followed-game results, each defaulting on, all beneath the existing per-chat mute/privacy gates.
- **FR-010**: All game copy stays name-first and the animated design language applies (challenge announcement, accept moment, result), consistent with spec 0008's palette and rules.

### Key Entities

- **Challenge**: an open invitation inside a group chat or Wall post — creator, game type, theme, state (open / accepted / cancelled), and once accepted, the game session and its two players.
- **Acceptance**: a member's sealed claim to the open seat, carrying its timestamp for deterministic first-wins resolution.
- **Follow**: a device-local, private subscription to one game's move/result notifications.

## Zero-Knowledge Impact *(constitution Principle I)*

- **What crosses the wire**: challenge, accept, cancel, and move signals as sealed payloads over the existing group sender-key channels; Wall challenges within the existing sealed post/engagement structures (contracts/wall-game-engagement.md).
- **What is encrypted**: everything — who challenges, which game, every accept and move, who plays, who wins.
- **What the server unavoidably sees**: the same envelope metadata as ordinary group messages; on the Wall, additionally the engagement KIND STRING `game` on sealed records — the same class of metadata as its existing reaction-vs-comment distinction — and it fans its existing content-free push to the post's audience for that kind (payloads stay opaque; no schema change). Justified in plan.md's Complexity table.
- **Why**: challenges are message content between people who already share encrypted channels; observers receive state because group fan-out already delivers it. Follow never leaves the device.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a group of any size, 100% of devices converge on the same opponent for a challenge, including staged accept races across offline gaps.
- **SC-002**: Observers receive zero game notifications unless they follow; followers receive exactly one notification per accepted move plus one for the result.
- **SC-003**: A Wall challenge is visible to exactly the selected audience and to no one else, for the game's whole life.
- **SC-004**: The server-side diff for the group story is empty; the Wall story changes exactly two minimal server behaviors (the engagement-kind allowlist and fanning the existing content-free push to the audience for game engagement) and adds no plaintext game data server-side.
- **SC-005**: Starting a challenge takes at most one step more than starting a 1:1 game (the audience/group is implicit in where you start it).

## Assumptions

- Two players per game (the 0008 engine's model); groups add an audience, not more seats.
- The one-game-per-chat gate extends to group chats unchanged.
- Followers' updates are notifications only; the board itself updates for everyone via the normal message flow regardless of following.
- Wall reactions/comments keep working on a game post like any post; no game-specific social surface in v1.
- Version skew accepted as in spec 0008: pre-0009 members see an unknown-kind fallback and simply can't participate until they update.
