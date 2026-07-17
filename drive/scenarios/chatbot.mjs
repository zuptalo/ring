/**
 * An interactive, PERSISTENT bot account on the live dev stack — for chatting with a
 * real device (phone / installed PWA on ring-dev.zuptalo.com) to test messaging &
 * notifications end-to-end. Unlike the throwaway driver accounts, this uses a
 * persistent browser profile (.tmp/drive/bot-profile) so the SAME Ring identity
 * survives across runs/turns. The bot is offline between runs, so the human's
 * messages queue in the relay and the bot drains them on the next `poll` — which is
 * exactly the offline→reconnect decrypt/notification path we've been fixing.
 *
 * Usage (dev stack must be up via `make start`):
 *   node drive/scenarios/chatbot.mjs init            → register (once) + print @username to share
 *   node drive/scenarios/chatbot.mjs poll            → accept friend requests + print recent messages
 *   node drive/scenarios/chatbot.mjs say "your text" → send to the connected peer
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE_URL = process.env.RING_DRIVE_URL ?? 'http://localhost:5173';
const PROFILE = path.join(ROOT, 'drive', '.tmp', 'bot-profile');
const WANT_USERNAME = process.env.BOT_USERNAME ?? 'claude';
const DISPLAY_NAME = process.env.BOT_NAME ?? 'Claude (test bot)';

const cmd = process.argv[2] ?? 'poll';
const arg = process.argv[3] ?? '';

mkdirSync(PROFILE, { recursive: true });

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: !process.env.HEADED,
  baseURL: BASE_URL,
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('console', (m) => {
  if (process.env.VERBOSE || /error|fail/i.test(m.text())) console.log(`[bot] ${m.type()}: ${m.text()}`);
});

async function poll(fn, ok, { timeout = 30_000, every = 250, label = 'cond' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > deadline) throw new Error(`poll timeout: ${label} (last=${JSON.stringify(v)})`);
    await new Promise((r) => setTimeout(r, every));
  }
}

const ok = await fetch(BASE_URL).then((r) => r.ok).catch(() => false);
if (!ok) { console.error(`dev stack not reachable at ${BASE_URL} — run \`make start\``); await ctx.close(); process.exit(1); }

await page.goto('/');
await page.waitForFunction(() => !!window.__ringTest, null, { timeout: 30_000 });

// Already registered? (persistent profile → device-key auto-unlock on load.)
let unlocked = await poll(() => page.evaluate(() => window.__ringTest.isUnlocked()), Boolean, { timeout: 6_000, label: 'unlock' }).catch(() => false);

if (cmd === 'init' && !unlocked) {
  // Register a fresh persistent account. Try the wanted username; on collision, suffix it.
  const assigned = await page.evaluate(async ({ want, name }) => {
    const t = window.__ringTest;
    const code = await t.freshCode();
    let used = want;
    for (let i = 0; i < 6; i++) {
      try { await t.register(code, used); break; }
      catch (e) {
        if (i === 5) throw e;
        used = `${want}${Math.floor(10 + Math.random() * 89)}`;
      }
    }
    await t.createAuto();
    await t.setProfile(name, 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>');
    return used;
  }, { want: WANT_USERNAME, name: DISPLAY_NAME });
  unlocked = await poll(() => page.evaluate(() => window.__ringTest.isUnlocked()), Boolean, { label: 'unlock-after-register' });
  console.log(`registered username candidate: ${assigned}`);
}

if (!unlocked) {
  console.error(`bot not unlocked. If first run, use: node drive/scenarios/chatbot.mjs init`);
  await ctx.close();
  process.exit(2);
}

// Make sure we're reachable in the directory + online for relay drain. Kicking the
// relay pull (previewPendingFull) alongside the WS reconnect reliably pulls a backlog
// the offline bot missed — a fresh headless context's WS drain alone can be slow to
// fire, which raced the chat snapshot in earlier polls.
const me = await page.evaluate(async () => {
  const t = window.__ringTest;
  await t.forceReconnect?.();
  for (let i = 0; i < 4; i++) {
    try { await t.previewPendingFull(); } catch (e) { /* ignore */ }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return { id: t.selfId(), username: await t.selfUsername() };
});
// Settle so the authoritative WS drain persists everything before we snapshot the chat.
await page.waitForTimeout(Number(process.env.DWELL_MS ?? 4000));

if (cmd === 'init') {
  console.log(`\n=== Ring test bot ready ===`);
  console.log(`  username:     @${me.username}`);
  console.log(`  display name: ${DISPLAY_NAME}`);
  console.log(`  user id:      ${me.id}`);
  console.log(`\nAdd @${me.username} from your phone (search the directory), then I'll run \`poll\` to accept.`);
}

if (cmd === 'say') {
  if (!arg) { console.error('usage: chatbot.mjs say "text"'); await ctx.close(); process.exit(3); }
  const sent = await page.evaluate(async (body) => {
    const t = window.__ringTest;
    const contacts = await t.contactIds();
    if (!contacts.length) return { ok: false, reason: 'no-contacts' };
    const peer = contacts[0];
    const chatId = await t.chatWith(peer);
    await t.sendChatMessage(chatId, body);
    return { ok: true, peer, chatId };
  }, arg);
  console.log(`say → ${JSON.stringify(sent)}`);
  // give the WS a moment to flush before we close
  await page.waitForTimeout(1500);
}

// burst: send several messages back-to-back in ONE session (a real rapid burst) so the
// recipient's phone exercises the SW notification path. `arg` is space-separated tokens;
// defaults to "1 2 3". e.g. node chatbot.mjs burst "1 2 3"
if (cmd === 'burst') {
  const tokens = (arg || '1 2 3').split(/\s+/).filter(Boolean);
  const sent = await page.evaluate(async (bodies) => {
    const t = window.__ringTest;
    const contacts = await t.contactIds();
    if (!contacts.length) return { ok: false, reason: 'no-contacts' };
    const chatId = await t.chatWith(contacts[0]);
    for (const b of bodies) {
      await t.sendChatMessage(chatId, b);
      await new Promise((r) => setTimeout(r, 250)); // tight burst, distinct messages
    }
    return { ok: true, chatId, count: bodies.length };
  }, tokens);
  console.log(`burst [${tokens.join(', ')}] → ${JSON.stringify(sent)}`);
  await page.waitForTimeout(1500);
}

// Always: accept any incoming connect request (directory-initiated lifecycle), then
// print recent messages per 1:1 chat.
const report = await page.evaluate(async () => {
  const t = window.__ringTest;
  // Directory connect requests: pull from the server, accept each by requester id, then
  // establish the contact + 1:1 chat so the E2EE session can form.
  let incoming = [];
  try {
    await t.syncConnections?.();
    incoming = t.incomingRequestIds?.() ?? [];
    for (const reqId of incoming) {
      try {
        await t.connectAccept(reqId);
        await t.importDirectoryUser?.(reqId);
        await t.startChat?.(reqId);
      } catch (e) { /* ignore one bad request */ }
    }
  } catch (e) { /* ignore */ }
  // Legacy friend-request store (harmless fallback).
  const pending = await t.pendingRequestIds();
  for (const id of pending) { try { await t.acceptRequest(id); } catch (e) { /* ignore */ } }
  await t.syncContactEdges?.();
  const contacts = await t.contactIds();
  const chats = [];
  for (const peer of contacts) {
    const name = await t.contactName(peer);
    const chatId = await t.chatWith(peer);
    const msgs = (await t.messages(chatId)).slice(-10).map((m) => ({
      dir: m.outgoing ? 'me→them' : 'them→me',
      body: m.body,
      kind: m.kind,
      status: m.status,
    }));
    chats.push({ peer, name, chatId, msgs });
  }
  return { acceptedNow: incoming.length + pending.length, contacts: contacts.length, chats };
});

console.log(`\naccepted ${report.acceptedNow} new request(s); ${report.contacts} contact(s).`);
for (const c of report.chats) {
  console.log(`\n--- chat with ${c.name || c.peer} (${c.peer}) ---`);
  if (!c.msgs.length) console.log('  (no messages yet)');
  for (const m of c.msgs) console.log(`  [${m.dir}] (${m.kind}/${m.status}) ${m.body}`);
}

// Let the relay drain / receipts flush before closing the offline-bot.
await page.waitForTimeout(1200);
await ctx.close();
