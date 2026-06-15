/**
 * Showcase screen capture. For each device project (see showcase.config.ts) this
 * registers a passwordless account, sets a profile, seeds the demo dataset via the
 * dev-only test hook, then screenshots each key screen in both light and dark into
 * showcase/output/<device>/<theme>/.
 */
import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

const SELF_NAME = 'Maya Chen';

// Screens to capture: [file name, route]. Routes resolve against the seeded data
// (chat/group ids come from showcase-seed.ts).
const SCREENS: Array<[string, string]> = [
  ['02-chats', '/tabs/chats'],
  ['03-chat', '/chat/sc-alice'],
  ['04-calls', '/tabs/calls'],
  ['05-contacts', '/tabs/contacts'],
  ['06-group', '/group/sc-trip'],
  ['07-settings', '/tabs/settings'],
  ['08-profile', '/settings/profile'],
];

async function waitHook(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__ringTest, null, { timeout: 30_000 });
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('ion-palette-dark', t === 'dark');
  }, theme);
  await page.waitForTimeout(250);
}

test('capture showcase', async ({ page }, info) => {
  const project = info.project.name;
  const outRoot = path.resolve(info.config.rootDir, 'output', project);

  const shoot = async (name: string, theme: Theme): Promise<void> => {
    const dir = path.join(outRoot, theme);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${name}.png`) });
  };

  // Pretend notifications are granted so the onboarding permission step doesn't
  // sit in front of the UI we want to capture.
  await page.context().addInitScript(() => {
    try {
      Object.defineProperty(Notification, 'permission', { get: () => 'granted', configurable: true });
    } catch {
      /* ignore */
    }
  });

  // 1) Auth (logged out).
  await page.goto('/');
  await waitHook(page);
  await page.waitForTimeout(800);
  for (const theme of THEMES) {
    await setTheme(page, theme);
    await shoot('01-auth', theme);
  }

  // 2) Register passwordless, set a profile (green initials avatar), seed demo data.
  await page.evaluate(async () => {
    const t = (window as any).__ringTest;
    const code = await t.freshCode();
    await t.register(code);
    await t.createAuto();
  });
  await page.waitForFunction(() => (window as any).__ringTest.isUnlocked() === true, null, { timeout: 30_000 });
  await page.evaluate(async (name) => {
    const t = (window as any).__ringTest;
    // Inline initials avatar (the generator isn't exposed on window).
    const parts = name.trim().split(/\s+/);
    const initials = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 200;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#10b981';
    ctx.fillRect(0, 0, 200, 200);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 90px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, 100, 108);
    await t.setProfile(name, c.toDataURL('image/png'));
    await t.seedShowcase();
  }, SELF_NAME);
  await page.waitForTimeout(800);

  // 3) Main screens, each in both themes (full reload per route keeps state clean).
  for (const theme of THEMES) {
    for (const [name, route] of SCREENS) {
      await page.goto(route);
      await page.waitForTimeout(700);
      await setTheme(page, theme);
      await shoot(name, theme);
    }
  }
});
