import { test, expect } from '@playwright/test';
import { createAccount, pair } from './helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Chat-history media (spec 1005): the chat resolves media object URLs only for the
 * rendered window (bounded, look-ahead paged), while the full-screen viewer still
 * spans the whole chat's media — it resolves and pins them on open. This guards
 * that opening the viewer after the list only resolved its window still works.
 */

const chatWith = (p: any, peerId: string) =>
  p.page.evaluate((id: string) => (window as any).__ringTest.chatWith(id), peerId);

async function pasteImage(p: any): Promise<void> {
  const composer = p.page.locator('ion-textarea.composer textarea');
  await composer.waitFor({ state: 'visible', timeout: 30_000 });
  await composer.click();
  await p.page.evaluate(() => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    const ta = document.querySelector('ion-textarea.composer textarea')!;
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await p.page.getByRole('button', { name: 'Send' }).click();
  await p.page.getByText('Original quality').click();
}

test('image renders in the list and the full-screen viewer opens on tap', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'MEDSCRL1');
  const b = await createAccount(ctxB, 'MEDSCRL2');
  await pair(a, b);

  const aChat = (await chatWith(a, b.id)) as string;
  await a.page.goto(`/chat/${aChat}`);
  await pasteImage(a);

  // The image resolves for the rendered window and shows in the list.
  const image = a.page.locator('.bubble .bubble-image').last();
  await expect(image).toBeVisible({ timeout: 30_000 });

  // A single tap opens the viewer directly (spec 1008), which resolves+pins the
  // chat's media on open (spec 1005).
  await image.click();
  await expect(a.page.locator('.viewer-modal')).toBeVisible({ timeout: 10_000 });

  await ctxA.close();
  await ctxB.close();
});

/* ---- spec 1011: smooth chat-history scroll-up on a 5,000-message chat ---- */

const SEED_N = 5000;
const ROW_BOUND = 220; // DOM bounded to useChatHistory's MAX_ROWS (~200) + a margin
const MAX_MEDIA = 60; // the media-LRU cap (spec 1005)

// Read the ion-content scroll metrics synchronously inside the page.
async function scrollMetrics(p: any): Promise<{ top: number; height: number; client: number }> {
  return p.page.evaluate(async () => {
    const el = await (document.querySelector('ion-content') as any).getScrollElement();
    return { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight };
  });
}
async function setScrollTop(p: any, top: number): Promise<void> {
  await p.page.evaluate(async (t: number) => {
    const el = await (document.querySelector('ion-content') as any).getScrollElement();
    el.scrollTop = t;
  }, top);
}
const renderedBubbles = (p: any) => p.page.locator('.bubble[data-mid]').count();
const firstRenderedId = (p: any): Promise<string | null> =>
  p.page.evaluate(() => (document.querySelector('.bubble[data-mid]') as HTMLElement)?.dataset.mid ?? null);

// Open a fresh chat bulk-seeded to `n` messages (instant, via the dev hook — no real
// send pipeline). Returns the chat id.
async function openSeededChat(a: any, b: any, n: number): Promise<string> {
  const aChat = (await chatWith(a, b.id)) as string;
  await a.page.evaluate(
    ({ id, count }: { id: string; count: number }) =>
      (window as any).__ringTest.seedMessages(id, count, { mediaEvery: 12 }),
    { id: aChat, count: n },
  );
  await a.page.goto(`/chat/${aChat}`);
  // Wait for the list to render its first window pinned to the newest message.
  await expect(a.page.locator('.bubble[data-mid]').first()).toBeVisible({ timeout: 30_000 });
  // Wheel events scroll the element under the cursor — center it over the list so the
  // tests' mouse.wheel(...) calls actually scroll the chat (not the header at 0,0).
  const vp = a.page.viewportSize() ?? { width: 640, height: 720 };
  await a.page.mouse.move(Math.floor(vp.width / 2), Math.floor(vp.height / 2));
  return aChat;
}

test('scroll-up is bounded and resolved media is capped (INV-3 / SC-008)', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SCRL1011A');
  const b = await createAccount(ctxB, 'SCRL1011B');
  await pair(a, b);
  await openSeededChat(a, b, SEED_N);

  // Bounded on open (newest ROW_CAP rows, not all 5,000).
  expect(await renderedBubbles(a)).toBeLessThanOrEqual(ROW_BOUND);

  // Flick up across many pages — the rendered count must stay bounded the whole way.
  for (let i = 0; i < 40; i++) {
    await a.page.mouse.wheel(0, -1400);
    await a.page.waitForTimeout(120);
    expect(await renderedBubbles(a)).toBeLessThanOrEqual(ROW_BOUND);
  }
  // Resolved media (decoded blob: images) stays under the LRU cap.
  const resolved = await a.page.locator('.bubble .bubble-image[src^="blob:"]').count();
  expect(resolved).toBeLessThanOrEqual(MAX_MEDIA);

  // Scroll back down through the evicted region — still bounded (downward re-entry).
  for (let i = 0; i < 60; i++) {
    await a.page.mouse.wheel(0, 1600);
    await a.page.waitForTimeout(100);
  }
  expect(await renderedBubbles(a)).toBeLessThanOrEqual(ROW_BOUND);

  await ctxA.close();
  await ctxB.close();
});

const bubbleTop = (p: any, id: string): Promise<number | null> =>
  p.page.evaluate((mid: string) => {
    const el = document.querySelector(`.bubble[data-mid="${mid}"]`) as HTMLElement | null;
    return el ? el.getBoundingClientRect().top : null;
  }, id);

test('older pages load before the top (INV-2) and the anchored message never jumps (INV-1)', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SCRL1011C');
  const b = await createAccount(ctxB, 'SCRL1011D');
  await pair(a, b);
  await openSeededChat(a, b, SEED_N);

  // Climb up into history so the look-ahead is actively paging older content.
  for (let i = 0; i < 12; i++) {
    await a.page.mouse.wheel(0, -1500);
    await a.page.waitForTimeout(140);
  }
  await a.page.waitForTimeout(300);

  // INV-2 (page-before-top): stepping up loads an older page (the first rendered id
  // changes) while scrollTop is still clearly above 0 — the page arrives before the top.
  let pagedBeforeTop = false;
  for (let i = 0; i < 25; i++) {
    const m = await scrollMetrics(a);
    if (m.top <= 4) break;
    const before = await firstRenderedId(a);
    await setScrollTop(a, Math.max(0, m.top - 500));
    await a.page.waitForTimeout(450); // let the load + (momentum-deferred) anchor settle
    const after = await firstRenderedId(a);
    if (after !== before && (await scrollMetrics(a)).top > 0) {
      pagedBeforeTop = true;
      break;
    }
  }
  expect(pagedBeforeTop).toBe(true);

  // INV-1 (≤2px): across the prepend/eviction a controlled step triggers, a tracked visible
  // bubble moves by EXACTLY the commanded scroll delta — the load itself adds no jump.
  let maxJump = 0;
  for (let i = 0; i < 6; i++) {
    const anchor = await a.page.evaluate(() => {
      const n = (Array.from(document.querySelectorAll('.bubble[data-mid]')) as HTMLElement[]).find(
        (e) => e.getBoundingClientRect().top > 140,
      );
      return n ? { id: n.dataset.mid as string, top: n.getBoundingClientRect().top } : null;
    });
    if (!anchor) break;
    const s0 = (await scrollMetrics(a)).top;
    if (s0 <= 4) break;
    await setScrollTop(a, Math.max(0, s0 - 300));
    const commanded = s0 - (await scrollMetrics(a)).top; // applied scroll before any correction
    await a.page.waitForTimeout(450); // allow the momentum-deferred correction to land
    const after = await bubbleTop(a, anchor.id);
    if (after == null) continue; // the tracked bubble was evicted this step — skip the sample
    // The bubble's on-screen move must equal the commanded scroll; a prepend adds ≤2px.
    maxJump = Math.max(maxJump, Math.abs(after - anchor.top - commanded));
  }
  expect(maxJump).toBeLessThanOrEqual(2);

  await ctxA.close();
  await ctxB.close();
});

test('an inbound message / reaction while scrolled up does not yank the view (INV-4 / SC-004)', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SCRL1011E');
  const b = await createAccount(ctxB, 'SCRL1011F');
  await pair(a, b);
  await openSeededChat(a, b, SEED_N);

  // Scroll up into history (not pinned to bottom).
  for (let i = 0; i < 8; i++) {
    await a.page.mouse.wheel(0, -1200);
    await a.page.waitForTimeout(100);
  }
  await a.page.waitForTimeout(300);
  const top0 = (await scrollMetrics(a)).top;

  // 1) A genuinely new inbound message arrives (B sends to A) — must not yank.
  const bChat = (await chatWith(b, a.id)) as string;
  await b.page.evaluate(
    ({ id }: { id: string }) => (window as any).__ringTest.sendChatMessage(id, 'ping while scrolled up'),
    { id: bChat },
  );
  await a.page.waitForTimeout(800);
  expect(Math.abs((await scrollMetrics(a)).top - top0)).toBeLessThanOrEqual(2);

  // 2) A reaction (a patch-in-place on an existing rendered row — the same path a
  //    seen/delivered status tick takes) on a message in view must not yank either. React
  //    to a bubble well INSIDE the viewport (a height change above the fold naturally
  //    shifts content; the no-yank guarantee is about not moving the read position).
  const midToReact = await a.page.evaluate(() => {
    const vh = window.innerHeight;
    const n = (Array.from(document.querySelectorAll('.bubble[data-mid]')) as HTMLElement[]).find((e) => {
      const t = e.getBoundingClientRect().top;
      return t > vh * 0.4 && t < vh * 0.8;
    });
    return n?.dataset.mid ?? null;
  });
  expect(midToReact).toBeTruthy();
  await a.page.evaluate((id: string) => (window as any).__ringTest.reactToMessage(id, '👍'), midToReact as string);
  await a.page.waitForTimeout(500);
  expect(Math.abs((await scrollMetrics(a)).top - top0)).toBeLessThanOrEqual(2);

  await ctxA.close();
  await ctxB.close();
});

test('tapping a reply-quote older than the loaded window seeks + centers it within ~1s (INV-6 / SC-006)', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await createAccount(ctxA, 'SEEK1011A');
  const b = await createAccount(ctxB, 'SEEK1011B');
  await pair(a, b);
  const aChat = await openSeededChat(a, b, SEED_N);

  // The OLDEST message — far older than the loaded newest window — is the seek target.
  const oldId = (await a.page.evaluate(
    (id: string) => (window as any).__ringTest.firstMessageId(id),
    aChat,
  )) as string;
  expect(oldId).toBeTruthy();
  expect(await a.page.locator(`.bubble[data-mid="${oldId}"]`).count()).toBe(0); // not loaded

  // Post a reply quoting it → a new bubble at the bottom carrying a tappable reply-quote.
  // (The same seekToMessage path serves the starred-message jump — US3 acceptance #2.)
  await a.page.evaluate(
    ({ id, q }: { id: string; q: string }) => (window as any).__ringTest.sendReply(id, 'jump back please', q),
    { id: aChat, q: oldId },
  );
  const replyRef = a.page.locator('.bubble .reply-ref').last();
  await expect(replyRef).toBeVisible({ timeout: 10_000 });

  const t0 = Date.now();
  await replyRef.click();
  // The target mounts + centers; no "Original message not available" toast.
  await expect(a.page.locator(`.bubble[data-mid="${oldId}"]`)).toBeVisible({ timeout: 1500 });
  expect(Date.now() - t0).toBeLessThanOrEqual(1500); // ~1.0s budget + emulation slack
  await expect(a.page.getByText('Original message not available')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
