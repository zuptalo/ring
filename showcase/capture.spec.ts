/**
 * Showcase screen capture. For each device project (see showcase.config.ts) this
 * registers a passwordless account, sets a profile (a real portrait, not initials),
 * seeds the demo dataset via the dev-only test hook — real photos/video/voice from
 * showcase/media/ (gitignored; see showcase/README.md) — then screenshots each key
 * screen in both light and dark into showcase/output/<device>/<theme>/.
 */
import { test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* eslint-disable @typescript-eslint/no-explicit-any */
const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

const SELF_NAME = 'Maya Chen';
const MEDIA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'media');

// Screens to capture: [file name, route]. Routes resolve against the seeded data
// (chat/group/contact/post ids come from showcase-seed.ts).
const SCREENS: Array<[string, string]> = [
  ['02-chats', '/tabs/chats'],
  ['03-chat', '/chat/sc-alice'],
  ['04-group', '/group/sc-trip'],
  ['05-wall', '/tabs/wall'],
  ['06-wall-post', '/wall/post/sc-post-album'],
  ['07-calls', '/tabs/calls'],
  ['08-contacts', '/tabs/contacts'],
  ['09-contact-detail', '/contact/sc-sofia'],
  ['10-all-media', '/chat/sc-trip/media'],
  ['11-settings', '/tabs/settings'],
  ['12-profile', '/settings/profile'],
  ['13-about', '/settings/about'],
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

function dataUrl(relPath: string, mime: string): string {
  const bytes = readFileSync(path.join(MEDIA_DIR, relPath));
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

/** width/height/duration of the demo video clip, read via ffprobe (dev-machine only —
 *  this file never ships; it's a Playwright test, not app code). */
function probeVideo(relPath: string): { width: number; height: number; durationSec: number } {
  const file = path.join(MEDIA_DIR, relPath);
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration',
    '-of', 'csv=p=0:s=,',
    file,
  ]).toString().trim();
  const [width, height, durationSec] = out.split(/[,\n]/).map(Number);
  return { width, height, durationSec };
}

/** Duration (sec) of an audio file, read via ffprobe. */
function probeDuration(relPath: string): number {
  const file = path.join(MEDIA_DIR, relPath);
  const out = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    file,
  ]).toString().trim();
  return Number(out);
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

  // 2) Register passwordless, set a profile (real portrait), seed demo data (real
  // photos/video/voice — read off disk here in Node, handed to the browser as data
  // URLs since showcase-seed.ts has no filesystem access).
  const video = probeVideo('video/dog.mp4');
  const assets = {
    avatars: {
      alice: dataUrl('avatars/alice.jpg', 'image/jpeg'),
      daniel: dataUrl('avatars/daniel.jpg', 'image/jpeg'),
      sofia: dataUrl('avatars/sofia.jpg', 'image/jpeg'),
      mom: dataUrl('avatars/mom.jpg', 'image/jpeg'),
      tomas: dataUrl('avatars/tomas.jpg', 'image/jpeg'),
    },
    photos: {
      cocktail: dataUrl('photos/cocktail.jpg', 'image/jpeg'),
      pastry: dataUrl('photos/pastry.jpg', 'image/jpeg'),
      arena1: dataUrl('photos/arena1.jpg', 'image/jpeg'),
      arena2: dataUrl('photos/arena2.jpg', 'image/jpeg'),
    },
    video: {
      dataUrl: dataUrl('video/dog.mp4', 'video/mp4'),
      poster: dataUrl('video/dog-poster.jpg', 'image/jpeg'),
      durationSec: Math.round(video.durationSec),
      width: video.width,
      height: video.height,
    },
    voice: {
      dataUrl: dataUrl('voice/voice.m4a', 'audio/mp4'),
      durationSec: Math.round(probeDuration('voice/voice.m4a')),
    },
  };
  const selfAvatar = dataUrl('avatars/self.jpg', 'image/jpeg');

  await page.evaluate(async () => {
    const t = (window as any).__ringTest;
    const code = await t.freshCode();
    await t.register(code);
    await t.createAuto();
  });
  await page.waitForFunction(() => (window as any).__ringTest.isUnlocked() === true, null, { timeout: 30_000 });
  await page.evaluate(
    async ({ name, avatar, seed }) => {
      const t = (window as any).__ringTest;
      await t.setProfile(name, avatar);
      await t.seedShowcase(seed);
    },
    { name: SELF_NAME, avatar: selfAvatar, seed: assets },
  );
  await page.waitForTimeout(800);

  async function settle(): Promise<void> {
    await page.waitForTimeout(1200);
    await page
      .waitForFunction(() => Array.from(document.images).every((img) => img.complete), null, { timeout: 5_000 })
      .catch(() => {});
  }

  // See showcase/README.md's "Known bug" note: ChatDetailPage can corrupt its paint
  // (the same bubble rendered more than once) whenever a 3rd+ message lands in a
  // chat that's already mounted — true whether that 3rd message arrives via the
  // initial load or a live append. Detect it directly and, if it happens, undo the
  // append and retry from the known-safe 2-message state rather than re-navigating
  // (a fresh reload would just reload all of Alice's messages at once and hit the
  // exact same bug).
  async function hasDuplicateBubbles(): Promise<boolean> {
    return page.evaluate(() => {
      const mids = Array.from(document.querySelectorAll('.bubble[data-mid]')).map((el) => el.getAttribute('data-mid'));
      return new Set(mids).size !== mids.length;
    });
  }

  async function enterAliceChat(): Promise<void> {
    for (let attempt = 1; attempt <= 8; attempt++) {
      await page.evaluate(async (seed) => {
        const t = (window as any).__ringTest;
        await t.seedAliceFollowup(seed);
      }, assets);
      await settle();
      if (!(await hasDuplicateBubbles())) return;
      console.log(`[showcase] duplicated bubbles appending Alice's chat, retry ${attempt}/8`);
      await page.evaluate(async () => {
        const t = (window as any).__ringTest;
        await t.clearAliceFollowup();
      });
      await page.reload();
      await settle();
    }
  }

  // Warm up every route once before the real capture pass (cheap insurance against
  // any cold-mount flakiness in general).
  for (const [, route] of SCREENS) {
    await page.goto(route);
    await page.waitForTimeout(1000);
  }

  // 3) Main screens, each in both themes (full reload per route keeps state clean).
  for (const theme of THEMES) {
    for (const [name, route] of SCREENS) {
      await page.goto(route);
      await settle();
      if (route === '/chat/sc-alice') await enterAliceChat();
      await setTheme(page, theme);
      await shoot(name, theme);
    }
  }
});
