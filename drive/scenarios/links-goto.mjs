// Minimal check: the links + docs tabs each expose a "Go to message" button that navigates
// to the chat. Light load (avoids overwhelming the dev ringd). `make start` must be up.
import { createAccount, pair, chatWith, say, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Ada' });
const b = await createAccount({ name: 'Bel' });
await pair(a, b);
const aChat = await chatWith(a, b.id);

await say(a, aChat, 'great read https://ring.example/post');
await a.page.evaluate((id) => window.__ringTest.seedMedia(id, 'file', 250_000), aChat);
await a.page.waitForTimeout(500);

const linkBtnCheck = async (tab) => {
  await a.page.goto(`http://localhost:5173/chat/${aChat}/media`);
  await a.page.waitForSelector(`ion-segment-button[value="${tab}"]`, { timeout: 15000 });
  await a.page.locator(`ion-segment-button[value="${tab}"]`).click({ force: true });
  await a.page.waitForTimeout(700);
  const n = await a.page.locator('ion-item button[aria-label="Go to message"]').count();
  console.log(`[goto] ${tab} tab: ${n} go-to-message button(s)`);
  await shot(a, `goto-${tab}`, {});
  if (n > 0) {
    await a.page.locator('ion-item button[aria-label="Go to message"]').first().click();
    await a.page.waitForTimeout(1500);
    const onChat = a.page.url().includes(`/chat/${aChat}`) && !a.page.url().includes('/media');
    console.log(`[goto] ${tab} → on chat page: ${onChat}`);
  }
};

await linkBtnCheck('links');
await linkBtnCheck('docs');

await sweep([a, b]);
await done();
