/**
 * Per-kind media quality: the contact info menu has separate Photo quality and Video quality rows,
 * each settable independently and persisted per chat.
 *
 *   HEADED=1 node drive/scenarios/chat-quality-perkind.mjs
 */
import { preflight, createAccount, pair, chatWith, shot, sweep, done, poll } from '../driver.mjs';

await preflight();
const [a, b] = [
  await createAccount({ name: 'Q', mobile: true }),
  await createAccount({ name: 'Bo', mobile: true }),
];
await pair(a, b);
await chatWith(a, b.id); // ensure a chat exists so the per-chat rows show

await a.page.goto(`/contact/${b.id}`);
await poll(
  () => a.page.evaluate(() => [...document.querySelectorAll('ion-label')].some((l) => /Photo quality/.test(l.textContent))),
  Boolean,
  { label: 'quality rows' },
);
const rows = await a.page.evaluate(() =>
  [...document.querySelectorAll('ion-item')]
    .filter((it) => /quality/i.test(it.textContent))
    .map((it) => it.textContent.replace(/\s+/g, ' ').trim()),
);
console.log('quality rows:', JSON.stringify(rows));
await shot(a, 'quality-rows');

// Set Video quality to SD and confirm the row updates (and persists in the chat record).
await a.page.evaluate(() => [...document.querySelectorAll('ion-item')].find((it) => /Video quality/.test(it.textContent))?.click());
await poll(() => a.page.evaluate(() => !!document.querySelector('ion-action-sheet')), Boolean, { label: 'video sheet' });
await a.page.evaluate(() => {
  const sheet = document.querySelector('ion-action-sheet');
  [...sheet.querySelectorAll('button')].find((x) => /^SD/.test(x.textContent.trim()))?.click();
  sheet?.dismiss?.();
});
await poll(
  () => a.page.evaluate(() => [...document.querySelectorAll('ion-item')].find((it) => /Video quality/.test(it.textContent))?.textContent.includes('SD')),
  Boolean,
  { label: 'video = SD' },
);
const videoRow = await a.page.evaluate(() => [...document.querySelectorAll('ion-item')].find((it) => /Video quality/.test(it.textContent))?.textContent.replace(/\s+/g, ' ').trim());
console.log('after set:', JSON.stringify(videoRow));

await sweep([a, b]);
await done();
