/**
 * The chat composer caps staged attachments at 10, even when the OS picker hands over more.
 *
 *   HEADED=1 node drive/scenarios/chat-media-cap.mjs
 */
import { preflight, createAccount, pair, chatWith, shot, sweep, done, poll } from '../driver.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

await preflight();
const [a, b] = [
  await createAccount({ name: 'Cappy', mobile: true }),
  await createAccount({ name: 'Bo', mobile: true }),
];
await pair(a, b);
const chatId = await chatWith(a, b.id);
await a.page.goto(`/chat/${chatId}`);
await poll(() => a.page.evaluate(() => !!document.querySelector('ion-textarea')), Boolean, { label: 'composer' });

// Hand the picker 12 photos at once.
const files = Array.from({ length: 12 }, (_, i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: PNG }));
await a.page.setInputFiles('input[type=file][multiple]', files);
await poll(() => a.page.evaluate(() => document.querySelectorAll('.paste-thumb').length), (n) => n > 0, { label: 'staged' });
await a.page.waitForTimeout(300);
const staged = await a.page.evaluate(() => document.querySelectorAll('.paste-thumb').length);
console.log(`picked 12, staged ${staged} (expect 10)`);
await shot(a, 'chat-media-cap');

await sweep([a, b]);
await done();
