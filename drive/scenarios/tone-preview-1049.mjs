/**
 * Spec 1049 smoke: play every alert tone in the real app and fail on any
 * console error (the vitest env has no Web Audio, so the render path —
 * convolver, compressor, strikes — only truly executes here). Ears still
 * required for the aesthetic pass; this proves it RUNS.
 */
import { createAccount, shot, sweep, done } from '../driver.mjs';

const u = await createAccount({ name: 'Toney' });
const errors = [];
u.page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
u.page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});

const tones = ['none', 'note', 'chime', 'ping', 'pop', 'pulse', 'glow', 'beacon'];
for (const t of tones) {
  await u.page.evaluate((name) => {
    // The same entry Settings previews use.
    return import('/src/services/sound.ts').then((m) => m.previewTone(name));
  }, t);
  await u.page.waitForTimeout(250);
}
// Burst: 10 rapid plays through the compressor bus (FR-005 smoke).
await u.page.evaluate(() =>
  import('/src/services/sound.ts').then((m) => {
    for (let i = 0; i < 10; i++) m.previewTone(i % 2 ? 'note' : 'beacon');
  }),
);
await u.page.waitForTimeout(1500);

await shot(u, 'tone-sound-page', { route: '/settings/notifications-reactions-sound' });
if (errors.length) {
  console.error('AUDIO ERRORS:', errors);
  process.exitCode = 1;
} else {
  console.log('all 8 tones + burst played with zero console errors');
}
await sweep([u]);
await done();
