/** Quick look at the video play overlay proportions (custom triangle on 48px disc). */
import { createAccount, pair, chatWith, sendVideo, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'TriA', mobile: true });
const b = await createAccount({ name: 'TriB' });
await pair(a, b);
const chat = await chatWith(a, b.id);
await sendVideo(a, chat, 'clip.mp4', 'original');
await a.page.goto(`/chat/${chat}`);
await a.page.waitForTimeout(1800);
await shot(a, 'play-triangle');
await sweep([a, b]);
await done();
