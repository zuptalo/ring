// Spec 1067 Track C1: manual verification that Ionic 9 + Vue Router 5 didn't
// regress the four tab roots, the settings choice/radio-group screen, the
// AuthPage, or the message composer (the exact spot the autocorrect
// boolean-coercion fix landed).
import {
  createAccount, newClient, pair, group, chatWith, say, waitForMessage,
  messageId, react, shot, sweep, done,
} from '../driver.mjs';

const ava = await createAccount({ name: 'Ava' });
const ben = await createAccount({ name: 'Ben', mobile: true });
const cleo = await createAccount({ name: 'Cleo' });
await pair(ava, ben);
const gid = await group(ava, 'Trio', [ben, cleo]);

// Four tab roots (Ava, desktop viewport).
for (const tab of ['chats', 'calls', 'contacts', 'settings']) {
  await shot(ava, `t019-tab-${tab}`, { route: `/tabs/${tab}` });
}
// Same four tabs on Ben's mobile (iPhone 13) viewport.
for (const tab of ['chats', 'calls', 'contacts', 'settings']) {
  await shot(ben, `t019-tab-${tab}-mobile`, { route: `/tabs/${tab}` });
}

// Settings choice screen (ion-radio-group / ion-radio) — Theme has no prerequisite state.
await shot(ava, 't019-settings-choice-theme', { route: '/settings/appearance-theme' });

// AuthPage — a fresh, unauthenticated context (createAccount's clients are already
// logged in and would just redirect away from /auth).
const fresh = await newClient({ label: 'fresh' });
await fresh.page.goto('/auth');
await fresh.page.waitForTimeout(600);
await shot(fresh, 't019-authpage');
await fresh.ctx.close();

// 1:1 chat: composer type-check (the exact spot :autocorrect="true/false" landed),
// then a real send/receive/react round-trip.
const avaChat = await chatWith(ava, ben.id);
await ava.page.goto(`/chat/${avaChat}`);
await ava.page.waitForTimeout(600);
await ava.page.locator('ion-textarea.composer').click();
await ava.page.keyboard.type('typing check');
await shot(ava, 't019-composer-typed');
await ava.page.locator('ion-textarea.composer').locator('textarea').fill('');
await say(ava, ben.id, 'hello from ava');
await waitForMessage(ben, ava.id, 'hello from ava');
const benChat = await chatWith(ben, ava.id);
const mid1 = await messageId(ben, benChat, 'hello from ava');
await react(ben, mid1, '👍');
await ava.page.waitForTimeout(900);
await shot(ava, 't019-1to1-reacted', { route: `/chat/${avaChat}` });

// Group chat: send + react.
await say(ava, gid, 'hello group', { isGroup: true });
await waitForMessage(ben, gid, 'hello group', { isGroup: true });
await waitForMessage(cleo, gid, 'hello group', { isGroup: true });
const mid2 = await messageId(ben, gid, 'hello group');
await react(cleo, mid2, '🎉');
await ben.page.waitForTimeout(900);
await shot(ben, 't019-group-reacted', { route: `/group/${gid}` });

await sweep([ava, ben, cleo]);
await done();
