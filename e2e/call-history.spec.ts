import { test, expect } from '@playwright/test';
import {
  createAccount, pair, startCall, reject, hangup, accept,
  waitCallState, waitCallLog, chatWith, messages, resetCallConfig,
} from './helpers';

/**
 * Two-sided call history (spec 0004): a call that's declined (or connects then ends) leaves a
 * history entry in the 1:1 chat on BOTH the caller's and the callee's device — the caller as
 * an outgoing entry, the callee as an incoming one — so neither side loses track of it.
 */

test.afterEach(async () => {
  await resetCallConfig();
});

test('a declined 1:1 call is logged on both the caller and the callee', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'HIST1A');
  const b = await createAccount(ctxB, 'HIST1B');
  await pair(a, b);

  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await reject(b);
  await waitCallState(a, ['idle', 'ended']);
  await waitCallState(b, ['idle', 'ended']);

  // Both sides recorded a call-history entry in their 1:1 chat.
  await waitCallLog(a, b.id);
  await waitCallLog(b, a.id);

  // ...and the directions are mirrored: outgoing on the caller, incoming on the callee.
  const aChat = await chatWith(a, b.id);
  const bChat = await chatWith(b, a.id);
  const aCall = (await messages(a, aChat)).find((m) => m.kind === 'call');
  const bCall = (await messages(b, bChat)).find((m) => m.kind === 'call');
  expect(aCall, 'caller has a call entry').toBeTruthy();
  expect(bCall, 'callee has a call entry').toBeTruthy();

  await ctxA.close();
  await ctxB.close();
});

test('a connected-then-ended 1:1 call is logged on both sides', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'HIST2A');
  const b = await createAccount(ctxB, 'HIST2B');
  await pair(a, b);

  await startCall(a, b.id, 'audio');
  await waitCallState(b, ['incoming']);
  await accept(b);
  await waitCallState(a, ['connected']);
  await hangup(a);
  await waitCallState(a, ['idle', 'ended']);
  await waitCallState(b, ['idle', 'ended']);

  await waitCallLog(a, b.id);
  await waitCallLog(b, a.id);

  await ctxA.close();
  await ctxB.close();
});
