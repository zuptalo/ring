// Media metadata lives in Message info now (not on the bubble), and is reachable for
// media in BOTH directions — incoming shows the metadata WITHOUT receipt sections.
import { readFileSync } from 'node:fs';
import { createAccount, pair, chatWith, poll, shot, sweep, done } from '../driver.mjs';
const gifB64 = readFileSync('.tmp/anim.gif.b64', 'utf8').trim();

const alice = await createAccount({ name: 'Alice' });
const bob = await createAccount({ name: 'Bob' });
await pair(alice, bob);
const aChat = await chatWith(alice, bob.id);
await alice.page.evaluate(([id, b]) => window.__ringTest.chatWith(id).then(c => window.__ringTest.sendImageData(c, b, 'image/gif', 'wave.gif', 'hd')), [bob.id, gifB64]);

// Wait until Bob actually has the chat AND the decoded image message.
const bChat = await poll(
  async () => {
    const c = await chatWith(bob, alice.id);
    if (!c) return null;
    const ok = await bob.page.evaluate((cc) => window.__ringTest.messages(cc).then((ms) => ms.some((m) => m.kind === 'image')), c);
    return ok ? c : null;
  },
  Boolean,
  { label: 'bob has the image', timeout: 30000 },
);

const readInfo = async (cli, chatId, label) => {
  const mid = await cli.page.evaluate((c) => window.__ringTest.messages(c).then((ms) => ms.find((m) => m.kind === 'image')?.id), chatId);
  await cli.page.goto(`/chat/${chatId}/info/${mid}`);
  await cli.page.waitForFunction(() => document.querySelectorAll('ion-list').length > 0, null, { timeout: 8000 }).catch(() => {});
  await cli.page.waitForTimeout(500);
  const data = await cli.page.evaluate(() => ({
    headers: Array.from(document.querySelectorAll('ion-list-header ion-label')).map((e) => e.textContent.trim()),
    rows: Array.from(document.querySelectorAll('ion-item')).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean),
  }));
  console.log(`[${label}] headers=${JSON.stringify(data.headers)} rows=${JSON.stringify(data.rows)}`);
  await shot(cli, `msginfo-${label}`, {});
  return data;
};
const inc = await readInfo(bob, bChat, 'incoming');
const out = await readInfo(alice, aChat, 'outgoing');

const incOk = inc.headers.includes('Media') && inc.rows.some((r) => /Format.*GIF/.test(r)) && inc.rows.some((r) => /96×96/.test(r)) && !inc.rows.some((r) => /Delivered|Seen|^Sent/.test(r));
const outOk = out.headers.includes('Media') && out.rows.some((r) => /Format.*GIF/.test(r)) && out.rows.some((r) => /Delivered|^Sent|Sent/.test(r));
console.log(incOk && outOk ? '[PASS] metadata in Message info; incoming = metadata only, outgoing = metadata + receipts' : '[FAIL] see above');
await sweep([alice, bob]); await done();
