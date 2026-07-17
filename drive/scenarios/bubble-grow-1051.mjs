// Spec 1051: short message + 5 reactions → the bubble must hold its chips.
import { createAccount, pair, chatWith, say, waitForMessage, messageId, react, poll, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Ava' });
const b = await createAccount({ name: 'Ben', mobile: true });
await pair(a, b);
await say(a, b.id, 'ok');
await waitForMessage(b, a.id, 'ok');
const bChat = await chatWith(b, a.id);
const mid = await messageId(b, bChat, 'ok');
const emo = async (who, e) => { await react(who, mid, e); await new Promise(r => setTimeout(r, 900)); };
await emo(b, '👍'); await emo(a, '😂'); await emo(b, '😮'); await emo(a, '😢'); await emo(b, '❤️');
await shot(a, 'bubble-grow-sender', { route: `/chat/${await chatWith(a, b.id)}` });
await shot(b, 'bubble-grow-mobile', { route: `/chat/${bChat}` });
await sweep([a, b]);
await done();
