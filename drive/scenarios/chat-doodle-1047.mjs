// Visual check (spec 1047): the chat wallpaper doodle — clearly visible in both
// themes, WhatsApp-comparable, bubbles unmistakably foreground.
import { createAccount, pair, say, waitForMessage, chatWith, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Me', label: 'A', mobile: true });
const b = await createAccount({ name: 'Biz', label: 'B' });
await pair(a, b);
await say(b, a.id, 'Salam! Check out the new wallpaper 🎨');
await waitForMessage(a, b.id, 'wallpaper');
await say(a, b.id, 'Bah bah, looking good!');
await say(b, a.id, 'Doodles everywhere');
await waitForMessage(a, b.id, 'Doodles');

await a.page.getByText("I'VE SAVED IT").click();
await a.page.waitForTimeout(500);
const chatId = await chatWith(a, b.id);
await a.page.goto(`/chat/${chatId}`);
await a.page.waitForTimeout(1500);
await shot(a, '1047-doodle-light');
await a.page.emulateMedia({ colorScheme: 'dark' });
await a.page.waitForTimeout(500);
await shot(a, '1047-doodle-dark');

await sweep([a, b]);
await done();
