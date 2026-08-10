import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const AVATAR = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';

test('message info renders receipt tiers with per-member times and ignores a post-send joiner', async ({ browser }) => {
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
  try {
    const [a, b, c, late] = await Promise.all([
      createAccount(contexts[0], 'MSGAUD1'),
      createAccount(contexts[1], 'MSGAUD2'),
      createAccount(contexts[2], 'MSGAUD3'),
      createAccount(contexts[3], 'MSGAUD4'),
    ]);
    for (const person of [a, b, c, late]) {
      const recovery = person.page.getByText("I'VE SAVED IT");
      if (await recovery.count()) await recovery.click();
    }
    for (const [person, name] of [[a, 'Alice'], [b, 'Bob'], [c, 'Carol'], [late, 'Erin']] as const) {
      await person.page.evaluate(([next, avatar]) => (window as any).__ringTest.setProfile(next, avatar), [name, AVATAR]);
    }
    for (const member of [b, c, late]) await pair(a, member);
    const groupId = await a.page.evaluate(
      (ids) => (window as any).__ringTest.createGroup('Trip', ids),
      [b.id, c.id],
    );
    for (const member of [b, c]) {
      await member.page.waitForFunction(
        (id) => (window as any).__ringTest.groupChats().then((rows: any[]) => rows.some((row) => row.id === id)),
        groupId,
      );
    }

    await a.page.evaluate((id) => (window as any).__ringTest.sendChatMessage(id, 'receipt tiers'), groupId);
    const messageId = await expect.poll(() => a.page.evaluate(
      (id) => (window as any).__ringTest.messages(id).then((rows: any[]) => rows.find((row) => row.body === 'receipt tiers')?.id ?? ''),
      groupId,
    )).toBeTruthy().then(() => a.page.evaluate(
      (id) => (window as any).__ringTest.messages(id).then((rows: any[]) => rows.find((row) => row.body === 'receipt tiers').id),
      groupId,
    ));
    await expect.poll(() => a.page.evaluate(
      (id) => (window as any).__ringTest.messageReceipts(id).then((rows: any[]) => rows.filter((row) => row.deliveredAt).length),
      messageId,
    ), { timeout: 30_000 }).toBe(2);
    await b.page.evaluate((id) => (window as any).__ringTest.markSeen(id), groupId);
    await expect.poll(() => a.page.evaluate(
      (id) => (window as any).__ringTest.messageReceipts(id).then((rows: any[]) => rows.filter((row) => row.seenAt).length),
      messageId,
    ), { timeout: 30_000 }).toBe(1);

    await a.page.evaluate((path) => { void (window as any).__ringTest.navigate(path); }, `/chat/${groupId}/info/${messageId}`);
    await expect(a.page.getByText('Seen by', { exact: true })).toBeVisible();
    const tierRows = a.page.locator('ion-item.tier-row');
    await expect(tierRows.nth(0).locator('.count')).toHaveText('1');
    await expect(tierRows.nth(1).locator('.count')).toHaveText('1');
    await tierRows.nth(0).click();
    const sheet = a.page.locator('ion-modal.show-modal');
    await expect(sheet).toContainText('Bob');
    await expect(sheet).toContainText(/\d{2}:\d{2}/);
    await sheet.evaluate((modal: any) => modal.dismiss());

    await a.page.evaluate(([id, member]) => (window as any).__ringTest.addMemberToGroup(id, member), [groupId, late.id]);
    await a.page.waitForTimeout(500);
    expect(await a.page.evaluate((id) => (window as any).__ringTest.messageReceipts(id), messageId)).toHaveLength(2);

    await a.page.evaluate(() => (window as any).__ringTest.setSetting('privacy.seenReceipts', false));
    await expect(a.page.getByText('Seen by', { exact: true })).toHaveCount(0);
  } finally {
    for (const context of contexts) await context.close();
  }
});
