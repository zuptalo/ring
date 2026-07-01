/**
 * The Album / Separate send-mode toggle: on its own row under the thumbnails, not squeezed beside
 * them (which truncated "Individual"). Stage 3 photos to reveal it.
 *
 *   HEADED=1 node drive/scenarios/chat-album-toggle.mjs
 */
import { preflight, createAccount, pair, chatWith, shot, sweep, done, poll } from '../driver.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

await preflight();
const [a, b] = [
  await createAccount({ name: 'Ally', mobile: true }),
  await createAccount({ name: 'Bo', mobile: true }),
];
await pair(a, b);
const chatId = await chatWith(a, b.id);
await a.page.goto(`/chat/${chatId}`);
await poll(() => a.page.evaluate(() => !!document.querySelector('ion-textarea')), Boolean, { label: 'composer' });

await a.page.setInputFiles(
  'input[type=file][multiple]',
  Array.from({ length: 3 }, (_, i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: PNG })),
);
await poll(() => a.page.evaluate(() => !!document.querySelector('.send-mode')), Boolean, { label: 'send-mode row' });
const labels = await a.page.evaluate(() =>
  Array.from(document.querySelectorAll('.send-mode ion-segment-button ion-label')).map((l) => l.textContent.trim()),
);
const lead = await a.page.evaluate(() => document.querySelector('.send-mode-label')?.textContent?.trim());
console.log('send-mode:', JSON.stringify({ lead, labels }));
await shot(a, 'chat-album-toggle');

await sweep([a, b]);
await done();
