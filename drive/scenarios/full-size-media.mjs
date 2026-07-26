// spec 1063 — verify full-size, aspect-preserving media bubbles. Send a wide 16:9 and a
// tall 9:16 so both extremes show in one view: 16:9 is width-driven (short); 9:16 is
// height-driven (capped ~60vh, never runs off-screen). Alice holds the full media → tests
// layout + retina crispness.
import { createAccount, pair, chatWith, shot, sweep, poll } from '../driver.mjs';

const a = await createAccount({ name: 'Alice', mobile: true });
const b = await createAccount({ name: 'Bob', mobile: true });
await pair(a, b);
const aChat = await chatWith(a, b.id);

for (const [w, h, n] of [[1280, 720, 'wide-16x9'], [720, 1280, 'tall-9x16']]) {
  await a.page.evaluate(([c, w, h, nm]) => window.__ringTest.sendImage(c, w, h, nm), [aChat, w, h, `${n}.png`]);
  await a.page.waitForTimeout(500);
}
await poll(
  () => a.page.evaluate((c) => window.__ringTest.messages(c), aChat),
  (msgs) => (msgs || []).filter((m) => m.kind === 'image').length >= 2,
  { label: 'images sent', timeout: 60000 },
);
await a.page.waitForTimeout(1500);
await shot(a, 'fullsize-wide-tall', { route: `/chat/${aChat}` });
await sweep([a, b]);
