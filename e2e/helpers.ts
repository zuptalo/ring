/**
 * e2e helpers that drive the app through the dev-only `window.__ringTest` hook:
 * register an account, pair two accounts (friend-request handshake → E2EE
 * session), and introspect call state. Each account is a separate browser
 * context (isolated IndexedDB / localStorage).
 *
 * Sibling: `drive/driver.mjs` is the standalone (no test-runner) variant of
 * `createAccount`/`pair` that ATTACHES to the running `make start` dev stack for
 * ad-hoc UI investigation. If you change the registration/pairing handshake here,
 * update it there too.
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
 *  identity passwordless (device-key auto-unlock - the default posture).
 *
 *  Single-use codes are a retry hazard: on a Playwright retry the seeded code is
 *  already consumed (invite-invalid) and the username `u_<code>` already claimed
 *  (username-taken), so the re-run would be doomed. Unless `mintOnConsumed` is
 *  false, we transparently mint a fresh dev code (which also yields a fresh
 *  derived username) and register with that. Pass `{ mintOnConsumed: false }`
 *  when the specific code matters (e.g. the invite-redemption test), so a real
 *  redemption failure is not masked. */
export async function createAccount(
  context: BrowserContext,
  code: string,
  opts: { mintOnConsumed?: boolean } = {},
): Promise<RingClient> {
  const mintOnConsumed = opts.mintOnConsumed ?? true;
  const page = await context.newPage();
  // Surface client-side logs/errors to the test output for debugging.
  page.on('console', (m) => {
    const t = m.text();
    if (/\[call\]|\[messaging\]|error|fail/i.test(t)) console.log(`[${code}] ${m.type()}: ${t}`);
  });
  page.on('pageerror', (e) => console.log(`[${code}] pageerror: ${e.message}`));
  await page.goto('/');
  await waitHook(page);
  try {
    await page.evaluate((c) => (window as any).__ringTest.register(c), code);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // A consumed code / claimed handle on a retry; mint a fresh one and continue.
    if (!mintOnConsumed || !/invit|username|taken|rejected/i.test(msg)) throw e;
    console.log(`[${code}] code unavailable (retry), minting a fresh one: ${msg}`);
    await page.evaluate(async () => {
      const fresh = await (window as any).__ringTest.freshCode();
      await (window as any).__ringTest.register(fresh);
    });
  }
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
  // The connect-request gate requires an accepted connection before a peer's prekey
  // bundle is fetchable. One link makes Connected() true both ways.
  await a.page.evaluate((peer) => (window as any).__ringTest.connectLink(peer), b.id);
  await b.page.evaluate((peer) => (window as any).__ringTest.connectLink(peer), a.id);
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
export const reject = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.reject());
export const hangup = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.hangup());
export const remoteTracks = (c: RingClient): Promise<number> =>
  c.page.evaluate(() => (window as any).__ringTest.remoteTracks());
export const callState = (c: RingClient): Promise<string> =>
  c.page.evaluate(() => (window as any).__ringTest.callState());
/** The per-device 1:1 chat id for a peer (resolve on each side). */
export const chatWith = (c: RingClient, peerId: string): Promise<string> =>
  c.page.evaluate((p) => (window as any).__ringTest.chatWith(p), peerId);
/** Messages in a chat ({ id, body, kind, ... }); a logged call is kind 'call'. */
export const messages = (c: RingClient, chatId: string): Promise<{ id: string; body: string; kind: string }[]> =>
  c.page.evaluate((id) => (window as any).__ringTest.messages(id), chatId);
/** Wait until `c`'s chat with `peerId` contains a call-history (kind 'call') entry. */
export async function waitCallLog(c: RingClient, peerId: string, timeout = 10_000): Promise<void> {
  const chatId = await chatWith(c, peerId);
  await c.page.waitForFunction(
    async (id: string) => (await (window as any).__ringTest.messages(id)).some((m: any) => m.kind === 'call'),
    chatId,
    { timeout, polling: 300 },
  );
}

/** Count call-log entries in the 1:1 chat with `peerId` (spec 0005 FR-010: a held-then-resumed
 *  call must log as ONE entry — hold/swap/resume never log). */
export async function callLogCount(c: RingClient, peerId: string): Promise<number> {
  const chatId = await chatWith(c, peerId);
  return c.page.evaluate(
    async (id: string) => (await (window as any).__ringTest.messages(id)).filter((m: any) => m.kind === 'call').length,
    chatId,
  );
}

/* ---- group calls (spec 0004) ---- */

/** Act as the INITIATOR: ring `members` into a group call `roomId` (they get an incoming
 *  invite to accept). Omit `members` to just JOIN an existing room. */
export const startGroup = (c: RingClient, roomId: string, kind: 'audio' | 'video', members: string[] = []) =>
  c.page.evaluate(
    ([r, k, m]) => (window as any).__ringTest.startGroup(r, k, m),
    [roomId, kind, members] as const,
  );
export const remoteStreamCount = (c: RingClient): Promise<number> =>
  c.page.evaluate(() => (window as any).__ringTest.remoteStreamCount());
export const roster = (c: RingClient): Promise<string[]> =>
  c.page.evaluate(() => (window as any).__ringTest.callMeta()?.roster ?? []);
export const recall = (c: RingClient, memberId: string) =>
  c.page.evaluate((m) => (window as any).__ringTest.recall(m), memberId);
export const removeInvitee = (c: RingClient, memberId: string) =>
  c.page.evaluate((m) => (window as any).__ringTest.removeInvitee(m), memberId);
export const notJoiningIds = (c: RingClient): Promise<string[]> =>
  c.page.evaluate(() => (window as any).__ringTest.notJoiningIds());
export const busyMemberIds = (c: RingClient): Promise<string[]> =>
  c.page.evaluate(() => (window as any).__ringTest.busyMemberIds());
export const invitedIds = (c: RingClient): Promise<string[]> =>
  c.page.evaluate(() => (window as any).__ringTest.invitedIds());
export const groupDiag = (c: RingClient): Promise<{ inboundVideoFrames: number; tiers: Record<string, string> }> =>
  c.page.evaluate(() => (window as any).__ringTest.groupCallDiag());
export const toggleVideo = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.toggleVideo());
export const toggleMute = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.toggleMute());
export const setGlobalSetting = (c: RingClient, key: string, value: unknown) =>
  c.page.evaluate(([k, v]) => (window as any).__ringTest.setGlobalSetting(k, v), [key, value] as const);
export const setVideoQuality = (c: RingClient, q: 'auto' | 'medium' | 'low') =>
  c.page.evaluate((v) => (window as any).__ringTest.setVideoQuality(v), q);

/** Spec 0007 adaptive-quality helpers. */

/** Per-leg adaptive-quality diagnostics for a mesh participant (the controller's tier, the ceiling
 *  the peer asked us for, our self-assessed downlink, and the limitation reason), keyed by the peer's
 *  short id. Built on the existing `groupCallDiag` test hook (extended for spec 0007 US5). */
export function legDiag(c: RingClient): Promise<{
  inboundVideoFrames: number;
  tiers: Record<string, string>;
  legs: Record<string, { tier: string; requestedByPeer?: string; downlink: string; limitation?: string }>;
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return c.page.evaluate(() => (window as any).__ringTest.groupCallDiag());
}

/** The tier `c` is currently SENDING to the peer whose id starts with `peerShort` (undefined if no
 *  such leg yet). */
export async function legTierTo(c: RingClient, peerShort: string): Promise<string | undefined> {
  const d = await legDiag(c);
  return d.legs[peerShort.slice(0, 8)]?.tier;
}

/** CDP network shaping for a participant's context. `null` lifts it. Profiles are coarse downlink
 *  caps used to drive a single receiver's downlink class down (spec 0007 US2). NOTE: Chromium applies
 *  emulateNetworkConditions at the network-service layer; on some builds it shapes app traffic more
 *  than UDP media — prefer the deterministic manual-pin path (US3) for the per-receiver assertion and
 *  treat the throttle path as corroborating. */
export async function throttle(c: RingClient, profile: 'poor' | 'ok' | null): Promise<void> {
  const cdp = await c.page.context().newCDPSession(c.page);
  if (profile === null) {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    });
    return;
  }
  const profiles = {
    poor: { downloadThroughput: (200 * 1024) / 8, uploadThroughput: (200 * 1024) / 8, latency: 300 },
    ok: { downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (4 * 1024 * 1024) / 8, latency: 40 },
  } as const;
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...profiles[profile] });
}

/** Wait until `c` reports exactly `n` remote streams (mesh peers). */
export async function waitRemotes(c: RingClient, n: number, timeout = 30_000): Promise<void> {
  await c.page.waitForFunction(
    (want: number) => (window as any).__ringTest.remoteStreamCount() === want,
    n,
    { timeout },
  );
}

/* ---- call waiting (spec 0005): hold / swap / drop ---- */
export const acceptAndHold = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.acceptAndHold());
export const swapCalls = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.swapCalls());
export const endActive = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.endActive());
export const endHeld = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.endHeld());
export const rejectSecond = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.rejectSecond());
export const hasSecondIncoming = (c: RingClient): Promise<boolean> =>
  c.page.evaluate(() => (window as any).__ringTest.hasSecondIncoming());
export const canHoldIncoming = (c: RingClient): Promise<boolean> =>
  c.page.evaluate(() => (window as any).__ringTest.canHoldIncoming());
export const heldCallId = (c: RingClient): Promise<string | null> =>
  c.page.evaluate(() => (window as any).__ringTest.heldCallId());
export const isRemoteHeld = (c: RingClient): Promise<boolean> =>
  c.page.evaluate(() => (window as any).__ringTest.isRemoteHeld());
export const groupHeldPeers = (c: RingClient): Promise<string[]> =>
  c.page.evaluate(() => (window as any).__ringTest.groupHeldPeers());
/** The resume countdown value for the party coming off hold (number while counting, else null). */
export const resumeCountdown = (c: RingClient): Promise<number | null> =>
  c.page.evaluate(() => (window as any).__ringTest.resumeCountdown());
/** Caller side: true when the callee we're ringing is busy but offered Accept & hold (queued). */
export const isRemoteQueued = (c: RingClient): Promise<boolean> =>
  c.page.evaluate(() => (window as any).__ringTest.isRemoteQueued());

/* ---- call-cue recording (spec 0004 US5) ---- */
export const recordCues = (c: RingClient, on: boolean) =>
  c.page.evaluate((v) => (window as any).__ringTest.recordCues(v), on);
export const cuesFired = (c: RingClient): Promise<string[]> =>
  c.page.evaluate(() => (window as any).__ringTest.cuesFired());

/* ---- connect-milestone instrumentation (spec 2008) ---- */
export const recordConnect = (c: RingClient, on: boolean) =>
  c.page.evaluate((v) => (window as any).__ringTest.recordConnect(v), on);
/** The current call's connect-milestone timestamps ({} if none yet). */
export const connectMarks = (c: RingClient): Promise<Record<string, number>> =>
  c.page.evaluate(() => (window as any).__ringTest.connectMarks());

/* ---- dev/e2e backend call-config (caps + ring/recovery cadence) ---- */
const BACKEND = `http://localhost:${process.env.RING_E2E_PORT || 8081}`; // isolated e2e ringd (see global-setup)
export interface CallConfig {
  videoMax?: number;
  audioMax?: number;
  ringCount?: number;
  ringIntervalMs?: number;
  recoveryGraceMs?: number;
}
/** Shrink participant caps / ring cadence on the shared backend so a cap or re-ring test
 *  needs only a few contexts and runs in seconds. The suite is serial, so this is per-test;
 *  ALWAYS resetCallConfig() in afterEach so later tests see production defaults. */
export async function setCallConfig(cfg: CallConfig): Promise<void> {
  const res = await fetch(`${BACKEND}/v1/dev/call-config`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  if (!res.ok) throw new Error(`call-config failed: ${res.status}`);
}
export const resetCallConfig = (): Promise<void> => setCallConfig({});

/* ---- notification helpers (spec 1015) ---- */

/** Drop / restore a client's WebSocket to simulate a closed (offline) app, so the
 *  relay queues messages and the service-worker preview path is exercised. */
export const goOffline = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.disconnect());
export const goOnline = (c: RingClient) => c.page.evaluate(() => (window as any).__ringTest.reconnect());

/** Current in-app notification banners (kind/name/body) for asserting alerting. */
export const notices = (c: RingClient): Promise<{ kind: string; name: string; body: string }[]> =>
  c.page.evaluate(() => (window as any).__ringTest.notices());

/** The body texts of the banners currently shown (convenience for `toContain`). */
export const noticeBodies = async (c: RingClient): Promise<string[]> =>
  (await notices(c)).map((n) => n.body);

/** Full closed-app background-preview result (notes + pending + suppressed + silenced),
 *  for asserting the service-worker decision (badge-only / web-push-off, FR-022/024). */
export const previewFull = (c: RingClient): Promise<{ notes: any[]; pending: number; suppressed: boolean; silenced: boolean }> =>
  c.page.evaluate(() => (window as any).__ringTest.previewPendingFull());

/** Top edge of the in-app banner and bottom edge of the header, so a test can assert
 *  the banner sits BELOW the header (FR-014 / SC-005). Null when either is absent. */
export const bannerVsHeader = (c: RingClient): Promise<{ bannerTop: number; headerBottom: number } | null> =>
  c.page.evaluate(() => {
    const nb = document.querySelector('.nb');
    const header = document.querySelector('ion-header') || document.querySelector('ion-toolbar');
    const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
    const b = rect(nb);
    const h = rect(header);
    return b && h ? { bannerTop: b.top, headerBottom: h.bottom } : null;
  });
