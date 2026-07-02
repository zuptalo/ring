import { test, expect } from '@playwright/test';
import { createAccount, pair, startCall, accept, hangup, waitCallState, remoteTracks } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Spec 1027 US4 — the "knock-knock call" (FR-013/FR-014): a live incoming call
// from a hidden-chat peer rings with FULL caller identity and is answerable
// (calls are never suppressed by hiding; supersedes 1019 FR-019's generic
// pre-answer identity), while the call leaves no Calls-tab entry naming the
// hidden peer as long as the chats are relocked.

const ev = (p: any, fn: (...a: any[]) => any, ...args: any[]): Promise<any> =>
  p.page.evaluate(fn, ...args);

test('a call from a hidden-chat peer rings with full identity and stays out of relocked history', async ({ browser }) => {
  test.setTimeout(150_000);
  const a = await createAccount(await browser.newContext(), 'KNOCK001');
  const b = await createAccount(await browser.newContext(), 'KNOCK002');
  await pair(a, b);

  // A hides the 1:1 with B. Give B a distinctive saved name so the identity
  // assert can't accidentally pass on a placeholder.
  await ev(a, (id: string) => (window as any).__ringTest.setContactName(id, 'Besnik Knock'), b.id);
  await ev(a, (id: string) => (window as any).__ringTest.startChat(id), b.id);
  const chat = await ev(a, (id: string) => (window as any).__ringTest.chatWith(id), b.id);
  await ev(a, (pin: string) => (window as any).__ringTest.hiddenSetPin(pin), '8642');
  await ev(a, (id: string) => (window as any).__ringTest.hiddenAdd(id), chat);

  // Knock knock: B calls A. The ring shows B's real name and avatar (FR-013).
  await startCall(b, a.id, 'audio');
  await waitCallState(a, ['incoming'], 40_000);
  const meta = await ev(a, () => (window as any).__ringTest.callMeta());
  expect(meta.name).toBe('Besnik Knock');
  expect(meta.name).not.toMatch(/private caller/i);
  expect(meta.avatar).toBeTruthy();
  expect(meta.avatar).not.toBe('');

  // ...and it is answerable like any call: accept → media flows both ways.
  await accept(a);
  await waitCallState(a, ['connected'], 40_000);
  await waitCallState(b, ['connected'], 40_000);
  await expect.poll(() => remoteTracks(a), { timeout: 30_000 }).toBeGreaterThan(0);
  await expect.poll(() => remoteTracks(b), { timeout: 30_000 }).toBeGreaterThan(0);
  await hangup(a);
  await waitCallState(b, ['idle', 'ended'], 30_000);

  // FR-014: while relocked, the Calls tab shows no row naming the hidden peer,
  // and the missed/unseen badge can't betray them either (this call wasn't
  // missed, so the row exclusion is the observable).
  const history = await ev(a, () => (window as any).__ringTest.callHistoryContactIds());
  expect(history).not.toContain(b.id);
  // B (nothing hidden there) logs the call normally — hiding is one-sided.
  await expect
    .poll(() => ev(b, () => (window as any).__ringTest.callHistoryContactIds()), { timeout: 15_000 })
    .toContain(a.id);
});
