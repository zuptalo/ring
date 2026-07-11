// Verify: on a fresh cold start of a RETURNING (already-authenticated) user whose Web
// Push permission is still undecided, the app asks "Turn on notifications?" — but it does
// NOT ask during the initial onboarding load (that flow owns the first ask).
//
//   node drive/scenarios/push-nudge-fresh-open.mjs
import { createAccount, shot, sweep } from '../driver.mjs';

const alice = await createAccount({ mobile: true, name: 'Alice', label: 'alice' });

// This first load went through /auth (registration), so the nudge must stay silent.
await alice.page.waitForTimeout(1500);
const onFirstLoad = await alice.page.evaluate(() =>
  !!document.querySelector('ion-alert') &&
  /Turn on notifications/.test(document.querySelector('ion-alert')?.textContent ?? ''),
);
console.log(`[check] nudge shown during onboarding load? ${onFirstLoad} (expect false)`);

// Headless Chromium reports Notification.permission as "denied" (no real device to
// prompt on), which the nudge correctly SKIPS. To exercise the real-device "default"
// path (a reinstall), stub the getter to "default" before the reload and no-op the
// native prompt so it doesn't hang the run.
await alice.page.addInitScript(() => {
  try {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'default' });
    Notification.requestPermission = async () => 'default';
  } catch { /* ignore */ }
});

// Simulate a returning cold start: reload the same (authenticated) context. The auth gate
// routes straight to /tabs (never /auth), so the nudge should fire.
await alice.page.reload({ waitUntil: 'domcontentloaded' });
await alice.page.waitForFunction(
  () => /Turn on notifications/.test(document.querySelector('ion-alert')?.textContent ?? ''),
  null,
  { timeout: 15_000 },
).catch(() => {});

const shown = await alice.page.evaluate(() => {
  const a = document.querySelector('ion-alert');
  return a ? (a.textContent ?? '').replace(/\s+/g, ' ').trim() : null;
});
console.log(`[check] nudge on returning cold start: ${JSON.stringify(shown)} (expect the "Turn on notifications?" ask)`);

await shot(alice, 'push-nudge-fresh-open');
await sweep([alice]);
