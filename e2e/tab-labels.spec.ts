import { test, expect } from '@playwright/test';
import { createAccount } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Tab-bar labels survive tab switching (spec 2024). A dynamic Vue `:class`
 * binding on `ion-tab-button` used to rewrite the element's whole className
 * whenever its value changed, erasing the Stencil-managed host classes
 * (`md`, `tab-has-label`, …) on the two buttons involved in every switch —
 * collapsing their labels to 0px height, one pair per click, until the whole
 * bar was bare icons. The fix drives the active-tab highlight with a
 * `data-on` ATTRIBUTE (Vue patches data-* via setAttribute, never touching
 * className).
 *
 * Assertion order matters for the red-first record (constitution III): the
 * label-height check runs FIRST so the red run fails on the actual bug (a
 * collapsed label), not on the then-nonexistent `data-on` attribute.
 */

const tabBtn = (page: any, label: string) => page.locator('ion-tab-button', { hasText: label });

const ALL_LABELS = ['Calls', 'Chats', 'Wall', 'Contacts', 'Settings'];

/** [{text, h}] for every tab button's label (h = rendered height in px). */
const labelStates = (page: any) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('ion-tab-bar ion-tab-button')).map((b: any) => {
      const l = b.querySelector('ion-label');
      return { text: l?.textContent ?? '', h: l ? Math.round(l.getBoundingClientRect().height) : -1 };
    }),
  );

/** Label texts of the buttons currently carrying the active `data-on` marker. */
const activeMarkers = (page: any) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('ion-tab-bar ion-tab-button'))
      .filter((b: any) => b.hasAttribute('data-on'))
      .map((b: any) => b.querySelector('ion-label')?.textContent ?? '?'),
  );

async function expectLabelsIntact(page: any): Promise<void> {
  const states = await labelStates(page);
  expect(states.map((s: any) => s.text).sort()).toEqual([...ALL_LABELS].sort());
  for (const s of states) expect(s.h, `label "${s.text}" collapsed to ${s.h}px`).toBeGreaterThan(0);
}

const WALK = [
  ['Calls', 'calls'],
  ['Wall', 'wall'],
  ['Contacts', 'contacts'],
  ['Settings', 'settings'],
  ['Chats', 'chats'],
] as const;

test.describe('tab-bar labels (spec 2024)', () => {
  test('labels keep their height through two full walks, and re-tapping the active tab is a no-op', async ({ browser }) => {
    const ctx = await browser.newContext();
    const a = await createAccount(ctx, 'TABLBL1');

    await a.page.goto('/tabs/chats');
    await tabBtn(a.page, 'Calls').waitFor({ state: 'visible', timeout: 30_000 });
    await expectLabelsIntact(a.page);

    // Two full cycles: the old bug destroyed the labels of the entered AND the
    // left tab on every click, so one cycle wipes the whole bar and the second
    // proves nothing degrades further.
    for (let round = 0; round < 2; round++) {
      for (const [label, slug] of WALK) {
        await tabBtn(a.page, label).click();
        await a.page.waitForURL(`**/tabs/${slug}`);
        await expectLabelsIntact(a.page);
      }
    }

    // Re-tap the active tab: no navigation, nothing degrades (FR-005 / contract row 6).
    const urlBefore = a.page.url();
    await tabBtn(a.page, 'Chats').click();
    await a.page.waitForTimeout(300);
    expect(a.page.url()).toBe(urlBefore);
    await expectLabelsIntact(a.page);

    await ctx.close();
  });

  test('exactly one tab carries the active marker, following the route', async ({ browser }) => {
    const ctx = await browser.newContext();
    const a = await createAccount(ctx, 'TABLBL2');

    await a.page.goto('/tabs/chats');
    await tabBtn(a.page, 'Calls').waitFor({ state: 'visible', timeout: 30_000 });
    expect(await activeMarkers(a.page)).toEqual(['Chats']); // marked from first load

    for (const [label, slug] of WALK) {
      await tabBtn(a.page, label).click();
      await a.page.waitForURL(`**/tabs/${slug}`);
      expect(await activeMarkers(a.page)).toEqual([label]);
    }

    await ctx.close();
  });
});
