/**
 * Spec 2004 visual check: the app-update prompt now renders through the shared in-app
 * notification overlay (NotificationBanners.vue) as a persistent rounded "action" card
 * below the header — never a top-pinned, sharp-cornered toast. Also shoots a functional
 * appToast() for the consistent-toast check.
 *
 *   HEADED=1 node drive/scenarios/update-banner.mjs
 *
 * Screenshots → .tmp/drive/*.png (Read them back to inspect).
 */
import { createAccount, shot, sweep, done } from '../driver.mjs';

const u = await createAccount({ name: 'Uma', mobile: true });

// Drive the real showActionBanner() through the app's own notify instance (the dev test
// hook re-exports it), so we render the actual production card, not a mock. (A raw
// dynamic import in page.evaluate loads a SECOND module copy whose ref the mounted
// component never sees — the hook shares the app's instance.)
await u.page.evaluate(() => window.__ringTest.showUpdateBanner());
await u.page.waitForTimeout(500);
await shot(u, '2004-update-banner');

// And a functional toast through the shared helper.
await u.page.evaluate(async () => {
  const { appToast } = await import('/src/services/toast.ts');
  await appToast({ message: "Muted Ada's Wall notifications", duration: 4000 });
});
await u.page.waitForTimeout(400);
await shot(u, '2004-app-toast');

await sweep([u]);
await done();
