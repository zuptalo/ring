import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);

// Long enough to truncate everywhere; starts with a strong RTL character.
const RTL_NAME = 'خانواده پفک نمکی و تاجی و همه فامیل های دور و نزدیک';

/**
 * Spec 2030: single-line name surfaces must derive their DIRECTION from the
 * name's content (dir="auto"), because text-overflow places the ellipsis by the
 * element's computed direction — with the app-shell ltr, a long Persian name
 * clipped its BEGINNING (the user-reported bug). :dir(rtl) resolving is the
 * machine-checkable proxy for "ellipsis on the correct side".
 */
test('RTL names resolve RTL directionality in the header and pinned tiles', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'RTLNAMA1');
  const b = await createAccount(ctxB, 'RTLNAMB1');
  await pair(a, b);

  // A group carries the RTL name (group names are user-chosen free text).
  const groupId = await a.page.evaluate(
    ({ name, members }: { name: string; members: string[] }) =>
      (window as any).__ringTest.createGroup(name, members),
    { name: RTL_NAME, members: [b.id] },
  );
  expect(groupId).toBeTruthy();

  // Chat header: the name element must resolve RTL for RTL content.
  await a.page.goto(`/chat/${groupId}`);
  const header = a.page.locator('.chat-header-name');
  await expect(header).toBeVisible({ timeout: 15_000 });
  await expect(a.page.locator('.chat-header-name:dir(rtl)')).toHaveCount(1);

  // Pinned tile: same rule in the grid.
  await a.page.evaluate((id: string) => (window as any).__ringTest.pinChat(id, true), groupId);
  await a.page.goto('/tabs/chats');
  await expect(a.page.locator('.pin-tile')).toHaveCount(1, { timeout: 15_000 });
  await expect(a.page.locator('.pin-name:dir(rtl)')).toHaveCount(1);

  // And a Latin name keeps LTR (no behavior change for existing users).
  const dm = (await chatWith(a, b.id)) as string;
  await a.page.goto(`/chat/${dm}`);
  await expect(a.page.locator('.chat-header-name')).toBeVisible({ timeout: 15_000 });
  await expect(a.page.locator('.chat-header-name:dir(ltr)')).toHaveCount(1);

  await ctxA.close();
  await ctxB.close();
});
