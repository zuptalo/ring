/**
 * Removing a staged attachment removes ONLY that item, even on a fast double-tap. Before the fix,
 * repeated taps reused a stale v-for index and deleted the next items too.
 *
 *   HEADED=1 node drive/scenarios/chat-remove-media.mjs
 */
import { preflight, createAccount, pair, chatWith, sweep, done, poll } from '../driver.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

await preflight();
const [a, b] = [
  await createAccount({ name: 'Rem', mobile: true }),
  await createAccount({ name: 'Bo', mobile: true }),
];
await pair(a, b);
const chatId = await chatWith(a, b.id);
await a.page.goto(`/chat/${chatId}`);
await poll(() => a.page.evaluate(() => !!document.querySelector('ion-textarea')), Boolean, { label: 'composer' });

await a.page.setInputFiles(
  'input[type=file][multiple]',
  Array.from({ length: 5 }, (_, i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: PNG })),
);
await poll(() => a.page.evaluate(() => document.querySelectorAll('.paste-thumb').length), (n) => n === 5, { label: '5 staged' });

// Fire TWO clicks on the first remove button synchronously, before Vue re-renders. With id-based
// removal the second is a no-op (that item is already gone), so exactly one is removed → 4 remain.
// The old index-based code would have spliced position 0 twice → 3 remain.
await a.page.evaluate(() => {
  const btn = document.querySelector('.paste-x');
  btn?.click();
  btn?.click();
});
await a.page.waitForTimeout(400);
const left = await a.page.evaluate(() => document.querySelectorAll('.paste-thumb').length);
console.log(`double-tap one ×: ${left} remain (expect 4, buggy=3)`);

await sweep([a, b]);
await done();
