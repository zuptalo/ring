// Visual check of the settings cleanup: screenshot each top-level settings screen
// to confirm removed rows are gone and nothing renders empty/dangling.
import { createAccount, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Settler', mobile: true });

for (const id of ['account', 'privacy', 'chats', 'notifications', 'help']) {
  await shot(a, `settings-${id}`, { route: `/settings/${id}`, fullPage: true });
}

await sweep([a]);
await done();
