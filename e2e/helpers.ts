/**
 * e2e helpers that drive the app through the dev-only `window.__ringTest` hook:
 * register an account, pair two accounts (friend-request handshake → E2EE
 * session), and introspect call state. Each account is a separate browser
 * context (isolated IndexedDB / localStorage).
 */
import type { BrowserContext, Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface RingClient {
  page: Page;
  id: string;
}

export async function waitHook(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__ringTest, null, { timeout: 30_000 });
}

/** Open a fresh context page, register with an invite code, and create the
 *  identity passwordless (device-key auto-unlock - the default posture). */
export async function createAccount(
  context: BrowserContext,
  code: string,
): Promise<RingClient> {
  const page = await context.newPage();
  // Surface client-side logs/errors to the test output for debugging.
  page.on('console', (m) => {
    const t = m.text();
    if (/\[call\]|\[messaging\]|error|fail/i.test(t)) console.log(`[${code}] ${m.type()}: ${t}`);
  });
  page.on('pageerror', (e) => console.log(`[${code}] pageerror: ${e.message}`));
  await page.goto('/');
  await waitHook(page);
  await page.evaluate((c) => (window as any).__ringTest.register(c), code);
  // createAuto is tolerant of the KeyGuard auto-create race (both call ensureIdentity).
  await page.evaluate(() => (window as any).__ringTest.createAuto());
  await page.waitForFunction(() => (window as any).__ringTest.isUnlocked() === true, null, {
    timeout: 30_000,
  });
  const id = (await page.evaluate(() => (window as any).__ringTest.selfId())) as string | null;
  if (!id) throw new Error('no self id after registration');
  return { page, id };
}

/** Wait until `viewer` can fetch `peerId`'s published prekey bundle (so the first
 *  sealed message won't no-op on a missing bundle). */
async function waitBundle(viewer: RingClient, peerId: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ok = (await viewer.page.evaluate(
      (id) => (window as any).__ringTest.peerBundleExists(id),
      peerId,
    )) as boolean;
    if (ok) return;
    await viewer.page.waitForTimeout(400);
  }
  throw new Error(`peer bundle for ${peerId} never became available`);
}

/** Connect two accounts using the in-network directory (no friend-request
 *  handshake - that's the whole point of the open network): each side imports the
 *  other (which mirrors their directory profile into contacts and marks them
 *  connected), then we wait until both prekey bundles are fetchable so the first
 *  message reliably bootstraps the X3DH session. */
export async function pair(a: RingClient, b: RingClient): Promise<void> {
  await waitBundle(a, b.id);
  await waitBundle(b, a.id);
  await a.page.evaluate((peer) => (window as any).__ringTest.importDirectoryUser(peer), b.id);
  await b.page.evaluate((peer) => (window as any).__ringTest.importDirectoryUser(peer), a.id);
  // Open the 1:1 chat on both sides (as tapping "Message" does), so a visible
  // chat exists for assertions - the directory model has no friend-request that
  // would otherwise create it.
  await a.page.evaluate((peer) => (window as any).__ringTest.startChat(peer), b.id);
  await b.page.evaluate((peer) => (window as any).__ringTest.startChat(peer), a.id);
  await a.page.waitForTimeout(300);
}

/** Wait until a client's call state equals one of the given states. */
export async function waitCallState(
  client: RingClient,
  states: string[],
  timeout = 30_000,
): Promise<void> {
  await client.page.waitForFunction(
    (s: string[]) => s.includes((window as any).__ringTest.callState()),
    states,
    { timeout },
  );
}

export function startCall(caller: RingClient, peerId: string, kind: 'audio' | 'video'): Promise<void> {
  return caller.page.evaluate(
    ([peer, k]) => (window as any).__ringTest.startCall(peer, k),
    [peerId, kind] as const,
  );
}

export const accept = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.accept());
export const hangup = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.hangup());
export const remoteTracks = (c: RingClient): Promise<number> =>
  c.page.evaluate(() => (window as any).__ringTest.remoteTracks());
