import { createAccount, shot, sweep, done } from '../driver.mjs';
const a = await createAccount({ name: 'Pat' });
await a.page.goto('/settings/privacy-hidden-chats');
await a.page.waitForSelector('ion-toggle', { timeout: 8000 });
// Toggle "Enable hidden chats" → should present the numeric PIN pad (PasscodeModal).
await a.page.locator('ion-toggle').first().click();
await a.page.waitForTimeout(1000);
const view = await a.page.evaluate(() => ({
  hasPad: !!document.querySelector('.pinpad, .pc-pick'),
  pickTitle: document.querySelector('.pc-title')?.textContent?.trim() ?? null,
  pickDesc: document.querySelector('.pc-desc')?.textContent?.trim()?.slice(0, 60) ?? null,
  hasTextInputs: !!document.querySelector('ion-alert input'),
}));
console.log('[hidden-pin]', JSON.stringify(view));
await shot(a, 'hidden-pin-pad', {});
console.log(view.hasPad && /Hidden Chats PIN/.test(view.pickTitle ?? '') && !view.hasTextInputs
  ? '[PASS] hidden PIN uses the numeric pad (not text boxes)' : '[FAIL] see above');
await sweep([a]); await done();
