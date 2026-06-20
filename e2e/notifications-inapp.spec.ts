import { test, expect } from '@playwright/test';
import { createAccount, pair, noticeBodies, bannerVsHeader } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Spec 1015 US4/US5: the global in-app master switch, the per-chat in-app toggle,
 * and per-chat content visibility actually gate the in-app banner. Driven entirely
 * through the live page path (B online + visible, off the A chat), reading the
 * in-app banner state via __ringTest.notices().
 *
 * Because the relay ack now follows the notify dispatch (FR-005 / T010), once B has
 * PERSISTED a message the banner decision is final — so we poll until B receives the
 * message, then assert the banner state deterministically (no sleeps/races).
 */
const ev = (p: any, fn: (a: any) => any, arg: any) => p.page.evaluate(fn, arg);
const bodiesOf = (p: any, chatId: string) =>
  ev(p, (id: string) => (window as any).__ringTest.messages(id).then((ms: any[]) => ms.map((m) => m.body)), chatId) as Promise<string[]>;

// Send `text` from A and resolve once B has persisted it (proves notify decided).
async function sendAndReceive(a: any, b: any, aChatWithB: string, bChatWithA: string, text: string): Promise<void> {
  await ev(a, ([id, t]: [string, string]) => (window as any).__ringTest.sendChatMessage(id, t), [aChatWithB, text]);
  await expect.poll(() => bodiesOf(b, bChatWithA), { timeout: 30_000 }).toContain(text);
}

test('in-app banners honor the global + per-chat toggles and content visibility', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'INAPP01');
  const b = await createAccount(ctxB, 'INAPP02');
  await ev(a, ([n]) => (window as any).__ringTest.setProfile(n, ''), ['Alice']);
  await pair(a, b);

  const aChat = (await ev(a, (id: string) => (window as any).__ringTest.chatWith(id), b.id)) as string;
  const bChat = (await ev(b, (id: string) => (window as any).__ringTest.chatWith(id), a.id)) as string;

  // Clear the settle window (a couple seconds after the pairing reconnects suppress
  // the banner burst), so the first real message can banner.
  await b.page.waitForTimeout(3000);

  // Baseline (content full, in-app on) → a banner with the actual text.
  await sendAndReceive(a, b, aChat, bChat, 'baseline ping');
  expect(await noticeBodies(b)).toContain('baseline ping');

  // GLOBAL in-app OFF → no banner at all (FR-018).
  await ev(b, () => (window as any).__ringTest.setGlobalSetting('notifications.inapp.enabled', false), null);
  await b.page.waitForTimeout(300); // let the settings-bus cache refresh
  await sendAndReceive(a, b, aChat, bChat, 'global off msg');
  expect(await noticeBodies(b)).not.toContain('global off msg');

  // GLOBAL in-app ON again → banners resume.
  await ev(b, () => (window as any).__ringTest.setGlobalSetting('notifications.inapp.enabled', true), null);
  await b.page.waitForTimeout(300);
  await sendAndReceive(a, b, aChat, bChat, 'global on msg');
  expect(await noticeBodies(b)).toContain('global on msg');

  // PER-CHAT in-app OFF for the A chat → no banner for it (FR-019).
  await ev(b, (id: string) => (window as any).__ringTest.setChatNotify(id, { inApp: false }), bChat);
  await sendAndReceive(a, b, aChat, bChat, 'chat inapp off');
  expect(await noticeBodies(b)).not.toContain('chat inapp off');
  await ev(b, (id: string) => (window as any).__ringTest.setChatNotify(id, { inApp: true }), bChat);

  // CONTENT = none → badge-only: no banner, nothing revealed (SC-007 / FR-024).
  await ev(b, (id: string) => (window as any).__ringTest.setChatNotify(id, { content: 'none' }), bChat);
  await sendAndReceive(a, b, aChat, bChat, 'content none msg');
  expect(await noticeBodies(b)).not.toContain('content none msg');

  // CONTENT = generic → a placeholder banner with no message text (FR-022).
  await ev(b, (id: string) => (window as any).__ringTest.setChatNotify(id, { content: 'generic' }), bChat);
  await sendAndReceive(a, b, aChat, bChat, 'content generic msg');
  const genBodies = await noticeBodies(b);
  expect(genBodies).not.toContain('content generic msg'); // the real text is masked
  expect(genBodies).toContain('New message'); // …replaced by the generic placeholder

  // CONTENT = full again → the real text returns.
  await ev(b, (id: string) => (window as any).__ringTest.setChatNotify(id, { content: 'full' }), bChat);
  await sendAndReceive(a, b, aChat, bChat, 'content full msg');
  expect(await noticeBodies(b)).toContain('content full msg');

  await ctxA.close();
  await ctxB.close();
});

/**
 * Spec 1015 US3 / FR-014 / SC-005: the in-app banner is anchored BELOW the header,
 * so it never overlaps the header/back control. Asserted geometrically via
 * getBoundingClientRect (deterministic, not a pixel snapshot).
 */
test('in-app banner renders below the header (no overlap with the toolbar)', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'INAPP03');
  const b = await createAccount(ctxB, 'INAPP04');
  await ev(a, ([n]) => (window as any).__ringTest.setProfile(n, ''), ['Alice']);
  await pair(a, b);

  const aChat = (await ev(a, (id: string) => (window as any).__ringTest.chatWith(id), b.id)) as string;
  const bChat = (await ev(b, (id: string) => (window as any).__ringTest.chatWith(id), a.id)) as string;

  // Stay on the chats list (which has a header) and clear the settle window.
  await b.page.waitForTimeout(3000);
  await sendAndReceive(a, b, aChat, bChat, 'geometry ping');

  // The banner element exists while it's shown.
  const banner = b.page.locator('.nb').first();
  await expect(banner).toBeVisible({ timeout: 5000 });
  await b.page.waitForTimeout(400); // let the slide-in (nb-in, 0.22s) settle before measuring

  const rects = await bannerVsHeader(b);

  expect(rects).not.toBeNull();
  // Banner's top edge sits at or below the header's bottom edge → no overlap.
  expect(rects!.bannerTop).toBeGreaterThanOrEqual(rects!.headerBottom - 2);

  await ctxA.close();
  await ctxB.close();
});
