// Visual check (spec 2028): screenshot the quick-forward button beside a tall
// portrait photo and a short text bubble, to eyeball the bottom-anchored position.
import { createAccount, pair, chatWith, say, shot, sweep, done, poll } from '../driver.mjs';

const a = await createAccount({ name: 'FwdA', label: 'A' });
const b = await createAccount({ name: 'FwdB', label: 'B' });
await pair(a, b);

const aChat = await chatWith(a, b.id);
await say(a, aChat, 'short message before the photo');
await a.page.evaluate(({ id }) => window.__ringTest.sendImage(id, 720, 1280), { id: aChat });

const bChat = await chatWith(b, a.id);
await b.page.goto(`/chat/${bChat}`);
await poll(
  () => b.page.locator('.fwd-float').count(),
  (n) => n > 0,
  { label: 'forward button rendered' },
);
await b.page.waitForTimeout(1500); // media decode settle
await shot(b, 'forward-button-position');

await sweep([a, b]);
await done();
