import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

// spec 2007 — HD/SD video sends must transcode for real on device, and the badge must
// never claim a quality the bytes aren't.
const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);

const settle = (p: any, messageId: string) =>
  expect
    .poll(() => p.page.evaluate((id: string) => (window as any).__ringTest.mediaInfo(id), messageId), {
      timeout: 90_000,
      message: `media ${messageId} settles past the encode phase`,
    })
    .toMatchObject({ status: expect.not.stringMatching(/compressing/) });

const info = (p: any, messageId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.mediaInfo(id), messageId);

test('a video that cannot be transcoded is labeled Original, never HD/SD (FR-007)', async ({ browser }) => {
  const a = await createAccount(await browser.newContext(), 'VIDQUAL1');
  const b = await createAccount(await browser.newContext(), 'VIDQUAL2');
  await pair(a, b);
  const chatId = await chatWith(a, b.id);

  // A 4-byte stub can't be decoded/transcoded by any engine, so even when the user
  // picks HD/SD the bytes that go out are the original — and the badge must say so.
  for (const quality of ['original', 'hd', 'sd'] as const) {
    const id: string = await a.page.evaluate(
      ([c, q]) => (window as any).__ringTest.sendMediaQuality(c, 'video', `stub-${q}.mp4`, q),
      [chatId, quality] as const,
    );
    await settle(a, id);
    expect((await info(a, id)).mediaQuality, `requested ${quality}`).toBe('original');
  }
});

test('HD and SD genuinely shrink the video; Original is byte-identical (FR-001/002/003, SC-001/002/003)', async ({
  browser,
}) => {
  const a = await createAccount(await browser.newContext(), 'VIDQUAL3');
  const b = await createAccount(await browser.newContext(), 'VIDQUAL4');
  await pair(a, b);
  const chatId = await chatWith(a, b.id);

  // The real-transcode path needs WebCodecs H.264 encode in this browser. Where it's
  // unavailable (some CI Chromium builds), the size-reduction half is covered by the
  // on-device verification (quickstart.md); the honesty half is the test above.
  const canEncode = await a.page.evaluate(async () => {
    const f = (window as any).VideoEncoder?.isConfigSupported;
    if (!f) return false;
    for (const codec of ['avc1.4d0028', 'avc1.42e028', 'avc1.640028']) {
      try {
        if ((await f({ codec, width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30 })).supported) return true;
      } catch {
        /* try next */
      }
    }
    return false;
  });
  test.skip(!canEncode, 'browser cannot encode H.264 via WebCodecs — covered on-device');

  const send = async (quality: 'original' | 'hd' | 'sd') => {
    const r: { messageId: string; sourceSize: number } = await a.page.evaluate(
      ([c, q]) => (window as any).__ringTest.sendRealVideoQuality(c, q, 1920, 1080, 2),
      [chatId, quality] as const,
    );
    await settle(a, r.messageId);
    return { ...(await info(a, r.messageId)), sourceSize: r.sourceSize };
  };

  const original = await send('original');
  const fhd = await send('fhd');
  const hd = await send('hd');
  const sd = await send('sd');

  // Original: untouched bytes + honest label.
  expect(original.mediaSize).toBe(original.sourceSize);
  expect(original.mediaQuality).toBe('original');
  expect(original.mediaWidth).toBe(1920);

  // Full HD re-encodes the 1080p source same-res at a lower bitrate → smaller.
  expect(fhd.mediaQuality).toBe('fhd');
  expect(fhd.mediaWidth).toBeLessThanOrEqual(1920);
  expect(fhd.mediaSize).toBeLessThan(original.mediaSize);

  // HD/SD: genuinely smaller, capped resolution, honest label.
  expect(hd.mediaQuality).toBe('hd');
  expect(hd.mediaWidth).toBeLessThanOrEqual(1280);
  expect(hd.mediaSize).toBeLessThan(fhd.mediaSize);

  expect(sd.mediaQuality).toBe('sd');
  expect(sd.mediaWidth).toBeLessThanOrEqual(640);
  expect(sd.mediaSize).toBeLessThan(hd.mediaSize);

  // The sender's on-device copy is the SENT (smaller) blob, not the full original, so
  // storage reflects what was sent (spec 2007). storedBytes tracks mediaSize.
  expect(fhd.storedBytes).toBe(fhd.mediaSize);
  expect(fhd.storedBytes).toBeLessThan(fhd.sourceSize);
  expect(sd.storedBytes).toBe(sd.mediaSize);
  // Original keeps the full bytes on device (nothing was re-encoded).
  expect(original.storedBytes).toBe(original.sourceSize);
});

test('the picker offers only tiers a source can produce — no upscaling (FR-011)', async ({ browser }) => {
  const a = await createAccount(await browser.newContext(), 'VIDQUAL5');
  // availableQualities is the single source of truth the picker renders from.
  const offered = await a.page.evaluate(async () => {
    const { availableQualities } = await import('/src/services/media-encode.ts');
    return {
      uhd: availableQualities(3840),
      fhd: availableQualities(1920),
      hd: availableQualities(1280),
      tiny: availableQualities(480),
    };
  });
  expect(offered.uhd).toEqual(['sd', 'hd', 'fhd', 'original']); // Full HD is the top tier
  expect(offered.fhd).toEqual(['sd', 'hd', 'fhd', 'original']);
  expect(offered.hd).toEqual(['sd', 'hd', 'original']); // no Full HD (would upscale)
  expect(offered.tiny).toEqual(['original']); // nothing to downscale to
});
