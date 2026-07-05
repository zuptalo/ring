/**
 * Spec 0008: two users play themed tic-tac-toe inside a 1:1 chat, on the REAL UI.
 *
 *   node drive/scenarios/tictactoe.mjs            (headless)
 *   HEADED=1 node drive/scenarios/tictactoe.mjs   (watch it)
 *
 * Drives moves through the same __ringTest hooks the e2e uses, but screenshots
 * the rendered surfaces at each stage: themed boards (Fire & Ice mid-game,
 * Space rematch), matchup header, animated status cues, the re-surface below a
 * burying text, the chat-list preview, and the game-stats Message info page.
 * Screenshots land in .tmp/drive/.
 */
import { createAccount, pair, chatWith, poll, say, waitForMessage, shot, sweep, done } from '../driver.mjs';

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob', mobile: true });
await pair(alice, bob);

const aChat = await chatWith(alice, bob.id);
const bChat = await chatWith(bob, alice.id);

const gameInfo = (c, mid) => c.page.evaluate((id) => window.__ringTest.gameInfo(id), mid);
const move = (c, chatId, mid, cell) =>
  c.page.evaluate((a) => window.__ringTest.playGameMove(a.chatId, a.mid, { cell: a.cell }), { chatId, mid, cell });
const movesSeen = async (c, mid) => (await gameInfo(c, mid))?.moves ?? -1;

// Alice starts a FIRE & ICE game; wait until Bob's device holds the bubble too.
const mid = await alice.page.evaluate(
  (id) => window.__ringTest.sendGame(id, 'tictactoe', 'fire-ice'),
  aChat,
);
await poll(() => gameInfo(bob, mid), (g) => !!g, { label: 'bubble reached Bob' });

// Fresh themed boards: Alice sees the die (your move), Bob the hourglass.
await shot(alice, 'ttt-1-alice-your-turn', { route: `/chat/${aChat}` });
await shot(bob, 'ttt-1-bob-their-turn', { route: `/chat/${bChat}` });

// Texts bury the game; moves re-surface it (FR-021).
await say(bob, alice.id, 'nice game so far!');
await waitForMessage(alice, bob.id, 'nice game so far');

// Alternate to Alice's win (row 0-1-2 vs Bob's 3,5).
const script = [
  [alice, aChat, 0], [bob, bChat, 3], [alice, aChat, 1], [bob, bChat, 5], [alice, aChat, 2],
];
let expected = 0;
for (const [who, chat, cell] of script) {
  await poll(() => movesSeen(who, mid), (n) => n === expected, { label: `move ${expected} synced` });
  await move(who, chat, mid, cell);
  expected += 1;
}
await poll(() => gameInfo(bob, mid), (g) => g?.status?.state === 'won', { label: 'win reached Bob' });

// Fire & Ice finished: confetti on Alice, gentle loss + Play again on Bob, and
// the bubble sits BELOW the burying text on both sides.
await shot(alice, 'ttt-2-alice-won', { route: `/chat/${aChat}` });
await shot(bob, 'ttt-2-bob-lost', { route: `/chat/${bChat}` });

// The game's story in numbers (FR-024): the Message info page for the match.
await shot(alice, 'ttt-3-alice-game-info', { route: `/chat/${aChat}/info/${mid}` });

// Bob starts a SPACE rematch and resigns it after a couple of moves.
const mid2 = await bob.page.evaluate(
  (id) => window.__ringTest.sendGame(id, 'tictactoe', 'space'),
  bChat,
);
await poll(() => gameInfo(alice, mid2), (g) => !!g, { label: 'rematch reached Alice' });
await move(bob, bChat, mid2, 4);
await poll(() => movesSeen(alice, mid2), (n) => n === 1, { label: 'rematch move synced' });
await shot(alice, 'ttt-4-alice-space-theme', { route: `/chat/${aChat}` });
await bob.page.evaluate((a) => window.__ringTest.resignGame(a.chatId, a.mid), { chatId: bChat, mid: mid2 });
await poll(() => gameInfo(alice, mid2), (g) => g?.status?.state === 'resigned', { label: 'resign reached Alice' });

await shot(bob, 'ttt-5-bob-resigned', { route: `/chat/${bChat}` });
await shot(alice, 'ttt-6-alice-chatlist-preview', { route: '/tabs/chats' });

await sweep([alice, bob]);
await done();
