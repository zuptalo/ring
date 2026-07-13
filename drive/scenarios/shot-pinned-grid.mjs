// Visual check (spec 1044): the iMessage-style pinned grid with several pins,
// in light and dark, plus the remaining list rows below.
import { createAccount, pair, chatWith, say, poll, shot, sweep, done } from '../driver.mjs';

// Real-looking disc avatars (canvas-drawn initial on a colored circle) — the
// driver's default blank-SVG avatar renders as nothing, which makes grid
// screenshots useless.
async function paintAvatar(p, name, color) {
  await p.page.evaluate(
    async ({ nm, col }) => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = col;
      g.beginPath();
      g.arc(64, 64, 64, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 64px -apple-system, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(nm[0], 64, 70);
      await window.__ringTest.setProfile(nm, c.toDataURL('image/png'));
    },
    { nm: name, col: color },
  );
}

const COLORS = ['#e74c3c', '#8e44ad', '#2980b9', '#16a085', '#d35400', '#2c3e50'];
const a = await createAccount({ name: 'Me', label: 'A' });
const peers = [];
for (const [i, name] of ['Biz', 'Feri', 'Rayan', 'Neda', 'Omid'].entries()) {
  const p = await createAccount({ name, label: name });
  await paintAvatar(p, name, COLORS[i]);
  await pair(a, p);
  peers.push(p);
}
// A message per chat so rows/tiles carry realistic ordering + previews.
for (const p of peers) {
  const chat = await chatWith(p, a.id);
  await say(p, chat, `Hi from ${p.label}!`);
}
await a.page.waitForTimeout(1500);

// Pin four of the five: 4 tiles (3 + 1 wrap) + one list row below.
for (const p of peers.slice(0, 4)) {
  const chat = await chatWith(a, p.id);
  await a.page.evaluate(({ id }) => window.__ringTest.pinChat(id, true), { id: chat });
}

await a.page.getByText("I'VE SAVED IT").click();
await a.page.waitForTimeout(800);
await a.page.goto('/tabs/chats'); // full reload is fine here (no live call state)
await poll(() => a.page.locator('.pin-tile').count(), (n) => n >= 4, { label: '4 tiles' });
await a.page.waitForTimeout(800);
await shot(a, 'pinned-grid-light');
await a.page.emulateMedia({ colorScheme: 'dark' });
await a.page.waitForTimeout(500);
await shot(a, 'pinned-grid-dark');

await sweep([a, ...peers]);
await done();
