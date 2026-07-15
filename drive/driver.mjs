/**
 * Ring UI investigation driver — drive the ALREADY-RUNNING dev app with Playwright.
 *
 * Spin up several throwaway test users, pair them, create groups, send + react to
 * messages, and screenshot the real UI — to reproduce/investigate an issue without
 * thinking twice. It attaches to the dev stack you already run with `make start`
 * (Vite http://localhost:5173 → ringd :8080 → dev Postgres) and drives everything
 * through the dev-only `window.__ringTest` hook (src/services/testhook.ts) — the
 * SAME surface the e2e suite uses, so scenarios exercise real client code paths.
 *
 * Plain Node ESM: no build step, no test runner. A scenario is ~10 lines:
 *
 *     // drive/scenarios/example.mjs
 *     import { createAccount, pair, say, waitForMessage, shot, sweep, done } from '../driver.mjs';
 *     const a = await createAccount({ name: 'Alice' });
 *     const b = await createAccount({ name: 'Bob', mobile: true });
 *     await pair(a, b);
 *     await say(a, b.id, 'hey');                 // 1:1: pass the PEER id
 *     await waitForMessage(b, a.id, /hey/);
 *     await shot(b, 'bob-chat', { route: `/chat/${await chatWith(b, a.id)}` });
 *     await sweep([a, b]); await done();
 *
 * Run it:  node drive/scenarios/example.mjs      (or: npm run drive drive/scenarios/example.mjs)
 * Watch:   HEADED=1 node drive/scenarios/example.mjs
 *
 * GOTCHAS (baked in here so you don't re-hit them):
 *  - Use poll() below, NOT page.waitForFunction(() => somePromise.then(...)). An
 *    async predicate to waitForFunction resolves EARLY/spuriously in a standalone
 *    node script (its returned promise reads truthy before settling). poll() is a
 *    real JS loop and is reliable. A SYNC predicate (e.g. () => !!window.__ringTest)
 *    is fine for waitForFunction.
 *  - 1:1 chat ids differ PER DEVICE (each side has its own local chat row). Resolve
 *    with chatWith(client, peerId) on EACH side. GROUP ids are shared (group() /
 *    createGroup return one id every member converges on). say()/waitForMessage()
 *    handle the 1:1 resolution for you when you pass a peer id.
 *  - Accounts use freshCode() (POST /v1/dev/invite) — never the finite seeded
 *    INVITE01..10 — so reruns never hit consumed-code / username-taken.
 *  - mobile:true = iPhone 13 emulation UNDER chromium (webkit isn't installed); UA
 *    + viewport + touch only. Fake media flags are set so calls work too.
 *  - Screenshots land in .tmp/drive/ (gitignored). The assistant Reads them back
 *    (the Read tool renders PNGs). Page console + ids stream to stdout.
 *  - Throwaway accounts linger in the dev DB. End scenarios with sweep([...]) to
 *    self-delete them, or hard-wipe with `make db-reset` (stop ringd first).
 *
 * Kept in step with e2e/helpers.ts (the test-runner variant of createAccount/pair).
 */
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Dev app URL the driver attaches to (override with RING_DRIVE_URL). */
export const BASE_URL = process.env.RING_DRIVE_URL ?? 'http://localhost:5173';
/** Where screenshots are written (gitignored via .tmp). */
export const SHOT_DIR = path.join(ROOT, '.tmp', 'drive');

/**
 * Poll `fn()` until `done(value)` is truthy, then return that value. The reliable
 * replacement for an async-predicate waitForFunction (see header). `fn` is usually
 * `() => client.page.evaluate(...)`.
 */
export async function poll(fn, done, { timeout = 30_000, every = 250, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (done(v)) return v;
    if (Date.now() > deadline) {
      throw new Error(`poll: timed out after ${timeout}ms waiting for ${label} (last=${JSON.stringify(v)})`);
    }
    await new Promise((r) => setTimeout(r, every));
  }
}

let _browser = null;
let _preflighted = false;

/** Fail fast (once) with a clear message if the dev stack isn't reachable. */
export async function preflight() {
  if (_preflighted) return;
  const ok = await fetch(BASE_URL).then((r) => r.ok).catch(() => false);
  if (!ok) {
    throw new Error(`dev stack not reachable at ${BASE_URL} — run \`make start\` first (or set RING_DRIVE_URL).`);
  }
  _preflighted = true;
}

/** Lazily launch one shared chromium. Fake media so 1:1/group calls work headless;
 *  HEADED=1 to watch, SLOWMO=<ms> to slow each action down. */
export async function browser() {
  if (!_browser) {
    _browser = await chromium.launch({
      headless: !process.env.HEADED,
      slowMo: process.env.SLOWMO ? Number(process.env.SLOWMO) : undefined,
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
  }
  return _browser;
}

/** A driven account: its own browser context (isolated IndexedDB) + page + Ring id. */
/** @typedef {{ ctx: import('@playwright/test').BrowserContext, page: import('@playwright/test').Page, id: string, label: string }} Client */

/** Open a fresh isolated context/page pointed at the dev app. `mobile` → iPhone 13
 *  emulation under chromium. Forwards page console/errors to stdout (filtered). */
export async function newClient({ mobile = false, label = '?' } = {}) {
  await preflight();
  const b = await browser();
  const ctx = await b.newContext({ baseURL: BASE_URL, ...(mobile ? devices['iPhone 13'] : {}) });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (process.env.VERBOSE || /\[call\]|\[messaging\]|\[pp\]|error|fail/i.test(t)) console.log(`[${label}] ${m.type()}: ${t}`);
  });
  page.on('pageerror', (e) => console.log(`[${label}] pageerror: ${e.message}`));
  return { ctx, page, label, id: '' };
}

/**
 * Register a fresh, passwordless account (device-key auto-unlock) in its own
 * context and return the Client. Always mints a fresh dev invite code, so reruns
 * never collide. Optionally sets a display name (+ a blank avatar).
 */
export async function createAccount({ mobile = false, name, label } = {}) {
  const c = await newClient({ mobile, label: label ?? name ?? 'acct' });
  await c.page.goto('/');
  await c.page.waitForFunction(() => !!window.__ringTest, null, { timeout: 30_000 }); // sync predicate → OK
  await c.page.evaluate(async (nm) => {
    const t = window.__ringTest;
    const code = await t.freshCode();
    await t.register(code);
    await t.createAuto();
    if (nm) await t.setProfile(nm, 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>');
  }, name);
  await poll(() => c.page.evaluate(() => window.__ringTest.isUnlocked()), (v) => v === true, { label: `${c.label} unlocked` });
  c.id = await c.page.evaluate(() => window.__ringTest.selfId());
  if (!c.id) throw new Error(`${c.label}: no self id after registration`);
  console.log(`[${c.label}] registered ${c.id}`);
  return c;
}

/** The PER-DEVICE 1:1 chat id for a peer (resolve separately on each side). */
export const chatWith = (c, peerId) => c.page.evaluate((p) => window.__ringTest.chatWith(p), peerId);

/** Connect two accounts via the directory and open the 1:1 chat both sides.
 *  Ported from e2e/helpers.ts pair() — keep in sync. */
export async function pair(a, b) {
  await a.page.evaluate((p) => window.__ringTest.connectLink(p), b.id);
  await b.page.evaluate((p) => window.__ringTest.connectLink(p), a.id);
  await poll(() => a.page.evaluate((p) => window.__ringTest.peerBundleExists(p), b.id), Boolean, { label: `${a.label} sees ${b.label} bundle` });
  await poll(() => b.page.evaluate((p) => window.__ringTest.peerBundleExists(p), a.id), Boolean, { label: `${b.label} sees ${a.label} bundle` });
  await a.page.evaluate((p) => window.__ringTest.importDirectoryUser(p), b.id);
  await b.page.evaluate((p) => window.__ringTest.importDirectoryUser(p), a.id);
  await a.page.evaluate((p) => window.__ringTest.startChat(p), b.id);
  await b.page.evaluate((p) => window.__ringTest.startChat(p), a.id);
  await a.page.waitForTimeout(300);
  console.log(`[pair] ${a.label} ↔ ${b.label}`);
}

/** Create a group owned by `owner` over already-paired member Clients. Returns the
 *  SHARED group id once every member's device has it. */
export async function group(owner, name, memberClients) {
  const ids = memberClients.map((m) => m.id);
  const gid = await owner.page.evaluate(([n, m]) => window.__ringTest.createGroup(n, m), [name, ids]);
  for (const m of memberClients) {
    await poll(
      () => m.page.evaluate((g) => window.__ringTest.groupChats().then((gs) => gs.some((x) => x.id === g)), gid),
      Boolean,
      { label: `${m.label} has group ${name}` },
    );
  }
  console.log(`[group] "${name}" = ${gid}`);
  return gid;
}

/** Send a message. 1:1 → pass the PEER id (resolved to the sender's chat id);
 *  group → pass the shared group id with { isGroup: true }. Returns the chat id used. */
export async function say(from, chatIdOrPeer, body, { isGroup = false } = {}) {
  const chatId = isGroup ? chatIdOrPeer : await chatWith(from, chatIdOrPeer);
  await from.page.evaluate(([c, t]) => window.__ringTest.sendChatMessage(c, t), [chatId, body]);
  return chatId;
}

/** Wait until `who` has received a message matching `match` (string substring or
 *  RegExp). 1:1 → pass the peer id; group → pass the group id + { isGroup: true }. */
export async function waitForMessage(who, chatIdOrPeer, match, { isGroup = false } = {}) {
  const re = match instanceof RegExp ? match : new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const chatId = isGroup ? chatIdOrPeer : await chatWith(who, chatIdOrPeer);
  return poll(
    () => who.page.evaluate((c) => window.__ringTest.messages(c), chatId),
    (msgs) => Array.isArray(msgs) && msgs.some((m) => re.test(m.body ?? '')),
    { label: `${who.label} receives ${re}` },
  );
}

/** Resolve a message id in a chat by matching its body (for react/info actions). */
export async function messageId(c, chatId, match) {
  const re = match instanceof RegExp ? match : new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const msgs = await c.page.evaluate((id) => window.__ringTest.messages(id), chatId);
  const m = (msgs ?? []).find((x) => re.test(x.body ?? ''));
  return m ? m.id : null;
}

/** Toggle an emoji reaction on a message. */
export const react = (c, msgId, emoji) =>
  c.page.evaluate(([id, e]) => window.__ringTest.reactToMessage(id, e), [msgId, emoji]);

/** Screenshot a client's page to .tmp/drive/<name>.png (optionally navigate first).
 *  Logs (and returns) the absolute path — Read it back to see the UI. */
export async function shot(client, name, { route, fullPage = false } = {}) {
  mkdirSync(SHOT_DIR, { recursive: true });
  if (route) {
    await client.page.goto(route);
    await client.page.waitForTimeout(600); // let the view settle/animate in
  }
  const file = path.join(SHOT_DIR, `${name}.png`);
  await client.page.screenshot({ path: file, fullPage });
  console.log(`[shot] ${file}`);
  return file;
}

/* ---- media sends (spec 1011 lengthy-chat exercise) ---- */

/** Send a voice/music audio message. */
export const sendAudio = (c, chatId, name = 'song.mp3', title = 'Song', artist = 'Artist') =>
  c.page.evaluate(([id, n, t, a]) => window.__ringTest.sendAudio(id, n, t, a), [chatId, name, title, artist]);
/** Send a round video-note ("video message"). */
export const sendVideoNote = (c, chatId, name = 'note.mp4') =>
  c.page.evaluate(([id, n]) => window.__ringTest.sendVideoNote(id, n), [chatId, name]);
/** Upload a photo (background-compressed at the given quality). */
export const sendImage = (c, chatId, name = 'photo.png', quality = 'hd') =>
  c.page.evaluate(([id, n, q]) => window.__ringTest.sendMediaQuality(id, 'image', n, q), [chatId, name, quality]);
/** Upload a video (background-compressed at the given quality). */
export const sendVideo = (c, chatId, name = 'clip.mp4', quality = 'hd') =>
  c.page.evaluate(([id, n, q]) => window.__ringTest.sendMediaQuality(id, 'video', n, q), [chatId, name, quality]);

/** Bulk-seed a chat to `n` messages instantly (spec 1011 dev hook) — builds a lengthy chat
 *  without the real send pipeline. `opts.mediaEvery` mixes in images for height variety. */
export const seedHistory = (c, chatId, n, opts = {}) =>
  c.page.evaluate(([id, count, o]) => window.__ringTest.seedMessages(id, count, o), [chatId, n, opts]);

/** Open a chat and flick up through `steps` look-ahead pages, screenshotting along the way
 *  so the captures can be Read back to confirm continuous content (no blank flash/snap). */
export async function scrollUpPass(client, chatId, name, { steps = 8, dy = 1400 } = {}) {
  await client.page.goto(`${BASE_URL}/chat/${chatId}`);
  await client.page.waitForTimeout(1000); // let the newest window render + pin to bottom
  // Wheel events scroll the element under the cursor — center it OVER the message list,
  // not the header (a wheel at the default (0,0) scrolls nothing / the wrong element).
  const vp = client.page.viewportSize() ?? { width: 640, height: 720 };
  await client.page.mouse.move(Math.floor(vp.width / 2), Math.floor(vp.height / 2));
  const shots = [await shot(client, `${name}-00-bottom`, {})];
  for (let i = 1; i <= steps; i++) {
    await client.page.mouse.wheel(0, -dy);
    await client.page.waitForTimeout(280); // let the older page load + anchor settle
    shots.push(await shot(client, `${name}-${String(i).padStart(2, '0')}-up`, {}));
  }
  return shots;
}

/** Count the rendered message bubbles (to confirm the DOM stays bounded while scrolling). */
export const bubbleCount = (c) => c.page.locator('.bubble[data-mid]').count();

/** Self-delete the given accounts (leave-no-trace cleanup of the dev directory). */
export const sweep = (clients) =>
  Promise.all(clients.map((c) => c.page.evaluate(() => window.__ringTest.deleteAccount()).catch(() => {})));

/** Close the shared browser (call at the end of a scenario). */
export async function done() {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}
