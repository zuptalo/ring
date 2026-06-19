// Verify "Go to message" from the all-media page (media viewer + links/docs rows) actually
// scrolls the chat to the right message. Run with `make start` up:
//   node drive/scenarios/go-to-message.mjs   (or HEADED=1 …)
import { createAccount, pair, chatWith, say, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Ada' });
const b = await createAccount({ name: 'Bel' });
await pair(a, b);
const aChat = await chatWith(a, b.id);

// An OLD image (the target), then lots of newer chatter so the target is far off-screen.
await a.page.evaluate((id) => window.__ringTest.sendImage(id, 1024, 768, 'target.png'), aChat);
await a.page.evaluate(async (id) => {
  for (let k = 0; k < 80; k++) {
    const ms = await window.__ringTest.messages(id);
    if (ms.some((m) => m.kind === 'image')) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}, aChat);
for (let i = 0; i < 40; i++) await say(a, aChat, `filler message ${i + 1}`);
// A shared link too, for the links-tab go-to-message.
await say(a, aChat, 'check this https://ring.example/welcome');

// Grab the target image message id.
const imgId = await a.page.evaluate(async (id) => {
  const ms = await window.__ringTest.messages(id);
  return ms.find((m) => m.kind === 'image')?.id;
}, aChat);

// Open the all-media page, open the viewer on the image, then "Go to message".
await a.page.goto(`http://localhost:5173/chat/${aChat}/media`);
await a.page.waitForTimeout(1000);
await a.page.locator('.media-grid .media-cell').first().click();
await a.page.waitForSelector('.viewer-track', { timeout: 10000 });
await a.page.waitForTimeout(500);
await a.page.locator('.v-top button[aria-label="More"]').click();
await a.page.waitForTimeout(300);
await a.page.locator('.v-menu button', { hasText: 'Go to message' }).click();
await a.page.waitForTimeout(1500);

const onChat = a.page.url().includes(`/chat/${aChat}`) && !a.page.url().includes('/media');
const targetVisible = await a.page.locator(`.bubble[data-mid="${imgId}"]`).isVisible().catch(() => false);
console.log('[goto] media-viewer → on chat page:', onChat, '· target image visible:', targetVisible);
await shot(a, 'goto-01-from-viewer', {});

// Now the links tab → go to message on the link row.
await a.page.goto(`http://localhost:5173/chat/${aChat}/media`);
await a.page.waitForTimeout(800);
await a.page.waitForSelector('ion-segment-button[value="links"]', { timeout: 15000 });
await a.page.locator('ion-segment-button[value="links"]').click({ force: true });
await a.page.waitForTimeout(800);
const linkBtns = await a.page.locator('ion-item button[aria-label="Go to message"]').count();
console.log('[goto] links-tab go-to-message buttons present:', linkBtns);
await a.page.locator('ion-item button[aria-label="Go to message"]').first().click();
await a.page.waitForTimeout(1500);
const linkOnChat = a.page.url().includes(`/chat/${aChat}`) && !a.page.url().includes('/media');
console.log('[goto] links-tab → on chat page:', linkOnChat);
await shot(a, 'goto-02-from-links', {});

await sweep([a, b]);
await done();
