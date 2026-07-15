/** Spec 1053: WhatsApp-style composer cluster — empty (camera + mic circle) vs
 *  typing (camera collapsed, send circle), light AND dark. Mobile viewport. */
import { createAccount, pair, chatWith, shot, sweep, done } from '../driver.mjs';

const kim = await createAccount({ name: 'Kim', mobile: true });
const pal = await createAccount({ name: 'Pal' });
await pair(kim, pal);
const chat = await chatWith(kim, pal.id);

const composer = kim.page.locator('ion-textarea.composer textarea');

for (const theme of ['light', 'dark']) {
  await kim.page.evaluate((t) => window.__ringTest.setGlobalSetting('appearance.theme', t), theme);
  await kim.page.goto(`/chat/${chat}`);
  await composer.waitFor({ timeout: 15_000 });
  await kim.page.waitForTimeout(600);
  await shot(kim, `composer-1053-${theme}-empty`);
  await composer.fill('Hello there');
  await kim.page.waitForTimeout(500); // let the transition settle
  await shot(kim, `composer-1053-${theme}-typing`);
  await composer.fill('');
  await kim.page.waitForTimeout(500);
}

await sweep([kim, pal]);
await done();
