/**
 * Composer polish: a pen hint on each staged thumbnail, a bottom-sheet caption editor (not an alert),
 * and a blocking "up to 10" alert when a pick goes over.
 *
 *   HEADED=1 node drive/scenarios/chat-caption-modal.mjs
 */
import { preflight, createAccount, pair, chatWith, shot, sweep, done, poll } from '../driver.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

await preflight();
const [a, b] = [
  await createAccount({ name: 'Cap', mobile: true }),
  await createAccount({ name: 'Bo', mobile: true }),
];
await pair(a, b);
const chatId = await chatWith(a, b.id);
await a.page.goto(`/chat/${chatId}`);
await poll(() => a.page.evaluate(() => !!document.querySelector('ion-textarea')), Boolean, { label: 'composer' });

// Stage 3 photos.
await a.page.setInputFiles(
  'input[type=file][multiple]',
  Array.from({ length: 3 }, (_, i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: PNG })),
);
await poll(() => a.page.evaluate(() => document.querySelectorAll('.paste-thumb').length), (n) => n === 3, { label: 'staged' });

// Pen hint present on thumbnails.
const pens = await a.page.evaluate(() => document.querySelectorAll('.paste-cap-hint').length);
console.log('pen hints:', pens);
await shot(a, 'caption-pen-hints');

// Tap a thumbnail → caption bottom sheet (a modal, not an alert) with a textarea.
await a.page.evaluate(() => document.querySelector('.paste-tap')?.click());
await poll(() => a.page.evaluate(() => !!document.querySelector('ion-modal.caption-modal ion-textarea')), Boolean, { label: 'caption sheet' });
const sheet = await a.page.evaluate(() => ({
  isModal: !!document.querySelector('ion-modal.caption-modal'),
  hasTextarea: !!document.querySelector('.caption-modal ion-textarea'),
  hasSave: [...document.querySelectorAll('.caption-modal ion-button')].some((x) => /save/i.test(x.textContent)),
}));
console.log('caption sheet:', JSON.stringify(sheet));
await shot(a, 'caption-modal');
await a.page.evaluate(() => {
  const btns = [...document.querySelectorAll('.caption-modal ion-button')];
  btns.find((x) => /cancel/i.test(x.textContent))?.click();
});

// Over-cap: pick 12 → a blocking alert appears.
await poll(() => a.page.evaluate(() => !document.querySelector('ion-modal.caption-modal')), Boolean, { label: 'sheet closed' });
await a.page.setInputFiles(
  'input[type=file][multiple]',
  Array.from({ length: 12 }, (_, i) => ({ name: `q${i}.png`, mimeType: 'image/png', buffer: PNG })),
);
await poll(() => a.page.evaluate(() => !!document.querySelector('ion-alert')), Boolean, { label: 'over-cap alert' });
const alertHeader = await a.page.evaluate(() => document.querySelector('ion-alert .alert-title, ion-alert .alert-head')?.textContent?.trim());
console.log('over-cap alert header:', JSON.stringify(alertHeader));

await sweep([a, b]);
await done();
