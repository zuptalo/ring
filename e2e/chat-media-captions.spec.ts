import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Spec 1023 — captioning chat media and album/individual sends.
 *
 * The headline fix: media PICKED from the library (not just pasted) now stages in the
 * composer so it can be captioned before sending — it used to send instantly with no
 * caption step. And several photos can go as one album or as individual messages, with a
 * shared caption applied to the album once / to each individual message.
 */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);

const messages = (p: any, chatId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.messages(id), chatId) as Promise<any[]>;

// A 1×1 PNG as a Playwright setInputFiles payload (same bytes the paste tests use).
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);
const pngFile = (name: string) => ({ name, mimeType: 'image/png', buffer: Buffer.from(PNG) });

// The hidden universal picker the "Media & File" attach option drives (the only one
// marked `multiple`; the camera input is single-capture).
const photoInput = (p: any) => p.page.locator('input[type="file"][multiple]');

test('media picked from the library can be captioned before sending (not just paste)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'PICKCAP1');
  const b = await createAccount(ctxB, 'PICKCAP2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await a.page.goto(`/chat/${aChat}`);
  const composer = a.page.locator('ion-textarea.composer textarea');
  await composer.waitFor({ state: 'visible', timeout: 30_000 });

  // Pick one image from the library → it STAGES (this used to send instantly with no
  // chance to caption — the bug).
  await photoInput(a).setInputFiles([pngFile('library.png')]);
  await expect(a.page.locator('.paste-thumb img')).toBeVisible({ timeout: 10_000 });
  await expect(composer).toHaveAttribute('placeholder', 'Add a caption');

  // Type a caption and send.
  await composer.click();
  await composer.pressSequentially('from my library', { delay: 12 });
  await a.page.getByRole('button', { name: 'Send' }).click();
  await a.page.getByText('Original quality').click(); // tiny PNGs only offer Original

  // The image bubble carries the caption; the staging row is cleared.
  await expect(a.page.locator('.bubble .bubble-image').last()).toBeVisible({ timeout: 30_000 });
  await expect(a.page.locator('.bubble .text', { hasText: 'from my library' })).toBeVisible();
  await expect(a.page.locator('.paste-thumb')).toHaveCount(0);

  // Receiver gets the image with the caption in its body.
  await b.page.waitForFunction(
    async (aid) => {
      const id = await (window as any).__ringTest.chatWith(aid);
      if (!id) return false;
      const ms = await (window as any).__ringTest.messages(id);
      return ms.some((m: any) => m.kind === 'image' && m.body === 'from my library');
    },
    a.id,
    { timeout: 30_000 },
  );

  await ctxA.close();
  await ctxB.close();
});

test('multiple picked photos can be sent individually, each carrying the shared caption', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'ALBUMCP1');
  const b = await createAccount(ctxB, 'ALBUMCP2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await a.page.goto(`/chat/${aChat}`);
  const composer = a.page.locator('ion-textarea.composer textarea');
  await composer.waitFor({ state: 'visible', timeout: 30_000 });

  // Pick THREE photos → three staged thumbs and the Album/Individual choice appears.
  await photoInput(a).setInputFiles([pngFile('a.png'), pngFile('b.png'), pngFile('c.png')]);
  await expect(a.page.locator('.paste-thumb')).toHaveCount(3, { timeout: 10_000 });
  await expect(a.page.locator('.send-mode ion-segment')).toBeVisible();

  // Choose Individual (the second of the two segment buttons), caption, send.
  await a.page.locator('.send-mode ion-segment-button').nth(1).click();
  await composer.click();
  await composer.pressSequentially('trip', { delay: 12 });
  await a.page.getByRole('button', { name: 'Send' }).click();
  await a.page.getByText('Original quality').click(); // tiny PNGs only offer Original

  // Three SEPARATE image messages (no shared albumId), each carrying the shared caption.
  await expect
    .poll(
      async () => {
        const id = (await chatWith(a, b.id)) as string;
        const ms = await messages(a, id);
        return ms.filter((m) => m.kind === 'image' && !m.albumId && m.body === 'trip').length;
      },
      { timeout: 30_000 },
    )
    .toBe(3);

  await ctxA.close();
  await ctxB.close();
});

test('a per-item caption overrides the shared caption for just that item', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'PERITEM1');
  const b = await createAccount(ctxB, 'PERITEM2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await a.page.goto(`/chat/${aChat}`);
  const composer = a.page.locator('ion-textarea.composer textarea');
  await composer.waitFor({ state: 'visible', timeout: 30_000 });

  // Stage two photos.
  await photoInput(a).setInputFiles([pngFile('one.png'), pngFile('two.png')]);
  await expect(a.page.locator('.paste-thumb')).toHaveCount(2, { timeout: 10_000 });

  // Tap the FIRST staged item → caption it individually via the alert.
  await a.page.locator('.paste-tap').first().click();
  const alertBox = a.page.locator('ion-alert textarea');
  await alertBox.waitFor({ state: 'visible', timeout: 10_000 });
  await alertBox.fill('just this one');
  await a.page.locator('ion-alert button', { hasText: 'Save' }).click();
  // The captioned item shows its badge ring.
  await expect(a.page.locator('.paste-thumb.has-cap')).toHaveCount(1);

  // Type a SHARED caption for the rest and send individually.
  await composer.click();
  await composer.pressSequentially('the others', { delay: 12 });
  await a.page.locator('.send-mode ion-segment-button').nth(1).click(); // Individual
  await a.page.getByRole('button', { name: 'Send' }).click();
  await a.page.getByText('Original quality').click(); // tiny PNGs only offer Original

  // The first item carries its own caption; the second falls back to the shared one.
  await expect
    .poll(
      async () => {
        const id = (await chatWith(a, b.id)) as string;
        const ms = await messages(a, id);
        const imgs = ms.filter((m) => m.kind === 'image' && !m.albumId);
        return {
          own: imgs.filter((m) => m.body === 'just this one').length,
          shared: imgs.filter((m) => m.body === 'the others').length,
        };
      },
      { timeout: 30_000 },
    )
    .toEqual({ own: 1, shared: 1 });

  await ctxA.close();
  await ctxB.close();
});

test('multiple picked photos sent as an album share one album id with a single caption', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'ALBUMCP3');
  const b = await createAccount(ctxB, 'ALBUMCP4');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await a.page.goto(`/chat/${aChat}`);
  const composer = a.page.locator('ion-textarea.composer textarea');
  await composer.waitFor({ state: 'visible', timeout: 30_000 });

  // Pick three photos and send WITHOUT changing the choice — Album is the default.
  await photoInput(a).setInputFiles([pngFile('a.png'), pngFile('b.png'), pngFile('c.png')]);
  await expect(a.page.locator('.paste-thumb')).toHaveCount(3, { timeout: 10_000 });
  await composer.click();
  await composer.pressSequentially('holiday', { delay: 12 });
  await a.page.getByRole('button', { name: 'Send' }).click();
  await a.page.getByText('Original quality').click(); // tiny PNGs only offer Original

  // All three images share ONE album id, and exactly one of them carries the caption.
  await expect
    .poll(
      async () => {
        const id = (await chatWith(a, b.id)) as string;
        const ms = await messages(a, id);
        const album = ms.filter((m) => m.kind === 'image' && m.albumId);
        const ids = new Set(album.map((m) => m.albumId));
        const captioned = album.filter((m) => m.body === 'holiday').length;
        return { count: album.length, albums: ids.size, captioned };
      },
      { timeout: 30_000 },
    )
    .toEqual({ count: 3, albums: 1, captioned: 1 });

  await ctxA.close();
  await ctxB.close();
});
