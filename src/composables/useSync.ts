/**
 * Owns the single Transport instance and connects it to the sync engine:
 *  - inbound frames → handleIncomingFrame (receipts/records/tombstones)
 *  - outbox changes / coming online → drainOutbox (push)
 *  - connection lifecycle follows auth (connect when registered, drop on logout)
 *
 * Singleton module state so it's set up once (called from App.vue). Exposes a
 * reactive `syncState` for any status UI. Uses MockTransport today; swapping in
 * the real WebSocket transport is a one-line change here.
 */
import { ref, watch } from 'vue';
import { subscribe } from '@/db/idb';
import { isAuthenticated, getToken, verifySessionOrReset, getPendingInviter } from '@/services/auth';
import { WebSocketTransport, type Frame, type Transport, type TransportState } from '@/services/transport';
import { handleIncomingFrame, drainOutbox } from '@/services/sync';
import { getChat, listMessages, listContacts, getSetting, drainPendingIncoming, listPendingInvites, resumePendingMediaJobs, refreshContactStatuses, refreshBlocks } from '@/db/queries';
import { deferNotificationsFor } from '@/services/notify';
import { publishOwnPreKeysOnce, replenishPreKeysIfLow } from '@/services/messaging';
import { runOwnSync, ownSyncQuiet } from '@/services/ownsync';
import { publishOwnProfile, syncContactEdges, refreshContactProfiles } from '@/services/directory';
import { applyPushPreference, disablePush, revalidatePushSubscription } from '@/services/push';
import { runInviteSync } from '@/services/invites';
import { clearPresence } from '@/composables/usePresence';
import { isInitialized, isUnlocked } from '@/services/crypto/identity';

const syncState = ref<TransportState>('offline');
let transport: Transport | null = null;
let started = false;

/* ---- presence ---- */

/** Derive the two visibility tiers ('everyone'|'contacts'|'nobody') from the
 *  privacy settings. The server enforces them against the contact graph. */
async function presencePrefs(): Promise<{ onlineTier: string; lastSeenTier: string }> {
  const lastSeenTier = await getSetting<string>('privacy.lastSeen', 'everyone');
  const online = await getSetting<string>('privacy.online', 'same');
  // 'same' tracks last-seen; 'everyone' always shares online presence.
  const onlineTier = online === 'everyone' ? 'everyone' : lastSeenTier;
  return { onlineTier, lastSeenTier };
}

async function sendPresencePrefs(): Promise<void> {
  if (!transport || transport.state !== 'online') return;
  const { onlineTier, lastSeenTier } = await presencePrefs();
  try {
    await transport.send({ t: 'presence-prefs', onlineTier, lastSeenTier });
  } catch {
    /* retried on next online */
  }
}

/** Subscribe to (watch) all our contacts' presence. */
async function sendPresenceSub(): Promise<void> {
  if (!transport || transport.state !== 'online') return;
  const ids = (await listContacts()).map((c) => c.id);
  if (!ids.length) return;
  try {
    await transport.send({ t: 'presence-sub', ids });
  } catch {
    /* retried on next online / contacts change */
  }
}

/** Subscribe to presence for an arbitrary set of ids (e.g. directory browse
 *  results, not just contacts). The server gates what it returns per the owner's
 *  visibility tier, so this only reveals presence we're allowed to see. */
export async function subscribePresence(ids: string[]): Promise<void> {
  if (!transport || transport.state !== 'online' || !ids.length) return;
  try {
    await transport.send({ t: 'presence-sub', ids });
  } catch {
    /* retried on next browse / reconnect */
  }
}

/** Report our own foreground/background state (so peers see us go offline the
 *  moment the app is backgrounded, not only when the socket drops). */
async function sendPresenceSelf(active: boolean): Promise<void> {
  if (!transport || transport.state !== 'online') return;
  try {
    await transport.send({ t: 'presence-self', active });
  } catch {
    /* best-effort */
  }
}

/** We count as "active" (online to peers) only when the app is foregrounded AND
 *  unlocked, so a device sitting at the passcode gate shows offline even though
 *  the relay is connected (for delivery receipts). */
function selfActive(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    isUnlocked.value
  );
}

// A persistent disconnect can mean the server simply rejected our token (account
// deleted / database wiped). Debounce a session check so a reconnect loop doesn't
// spam /v1/me; a successful 'online' cancels it. The check resets the device only
// on a definitive 401 (not on a server-down network error).
let sessionCheckTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSessionCheck(): void {
  if (!isAuthenticated.value) return;
  if (sessionCheckTimer) clearTimeout(sessionCheckTimer);
  sessionCheckTimer = setTimeout(() => void verifySessionOrReset(), 3000);
}
function cancelSessionCheck(): void {
  if (sessionCheckTimer) {
    clearTimeout(sessionCheckTimer);
    sessionCheckTimer = undefined;
  }
}

/** Nudge the transport to (re)connect if we're authenticated but offline. A
 *  live connection drains the outbox + relay queue on its 'online' transition. */
export function nudgeReconnect(): void {
  if (!transport || transport.state !== 'offline') return;
  const token = getToken();
  if (isAuthenticated.value && token) void transport.connect(token);
}

/** Test-only: drop the WebSocket so the server queues messages for this account
 *  (simulating a backgrounded/closed app), exercising the SW background-decrypt
 *  path. Reconnect with nudgeReconnect(). */
export function disconnectTransport(): void {
  transport?.disconnect();
}

function start(): void {
  if (started) return;
  started = true;
  transport = new WebSocketTransport();

  transport.onStateChange((s) => {
    syncState.value = s;
    if (s === 'online' && transport) {
      cancelSessionCheck(); // the WS auth passed → our token is valid
      void drainOutbox(transport); // flush what queued offline
      void resumePendingMediaJobs(); // re-attempt any interrupted/failed-but-retryable media
      // Publish our bundle (so peers can start sessions), then top up the
      // one-time prekey pool if it's low. Chained so the count check sees the
      // freshly-published pool.
      void (async () => {
        await publishOwnPreKeysOnce();
        await replenishPreKeysIfLow();
      })();
      void runOwnSync(); // back up recovery wrap + sync own data (no-op if locked)
      if (isUnlocked.value) void runInviteSync(); // connect inviter↔invitee on redemption
      if (isUnlocked.value) {
        void refreshBlocks(); // reconcile the local block ledger with the server
        void refreshContactStatuses(); // detect peers whose accounts were terminated → "Ghosted"
        void publishOwnProfile(); // make our display name/avatar/About visible in the directory
        // Contacts are CURATED (people you've interacted with or explicitly saved),
        // not the whole directory, so we no longer bulk-mirror the directory here.
        // Push our contact edges so the server can enforce the 'contacts' presence
        // tier; presence subscription runs via sendPresenceSub() below.
        void syncContactEdges();
        // Refresh contacts' name/photo/About from the directory (replaces the old
        // peer-to-peer "share my name & photo").
        void refreshContactProfiles();
      }
      void applyPushPreference(true); // (re)register or drop push per the notification prefs
      void sendPresencePrefs(); // upload our sharing booleans
      void sendPresenceSub(); // watch our contacts' presence
      void sendPresenceSelf(selfActive()); // correct the server's connect-default if we're locked
    } else if (s === 'offline') {
      clearPresence(); // don't show stale online status while disconnected
      scheduleSessionCheck(); // a rejected token would keep us stuck here
    }
  });
  // Serialize DB-mutating inbound frames through a promise chain so they're
  // applied one at a time. Two frames that arrive together (e.g. a duplicate
  // friend-request card racing the accept flow) would otherwise interleave at
  // await points and clobber each other's read-modify-write on the same chat /
  // contact records, re-pending an accepted chat, resetting `connected`, etc.
  // Call signalling + presence stay concurrent (latency-sensitive, no DB race).
  let inboundChain: Promise<void> = Promise.resolve();
  transport.onMessage((f) => {
    const live = f.t.startsWith('call-') || f.t.startsWith('sfu-') || f.t === 'presence';
    if (live) {
      void handleIncomingFrame(f);
      return;
    }
    inboundChain = inboundChain
      .then(async () => {
        await handleIncomingFrame(f);
        // Acknowledge inbound messages so the server drops them from the queue and
        // notifies the sender (delivered receipt).
        if (f.t === 'msg' && f.id && transport) {
          try {
            await transport.send({ t: 'ack', refId: f.id });
          } catch {
            /* will be redelivered on reconnect */
          }
        }
      })
      .catch(() => {
        /* one bad frame must not break the chain for the rest */
      });
  });

  // New outbox entry → push it (if online).
  subscribe(['outbox'], () => {
    if (transport) void drainOutbox(transport);
  });
  // Periodically re-drain so an in-flight message the server never confirmed (a lost
  // "sent" receipt, or the server restarting right after receiving it) is re-sent
  // until acknowledged, at-least-once delivery. A no-op when the outbox is empty.
  setInterval(() => {
    if (transport && transport.state === 'online') void drainOutbox(transport);
  }, 15_000);

  // While we have outstanding invitations (or just registered via one), poll for
  // redemptions so inviter↔invitee auto-connect without manual action.
  setInterval(() => void maybePollInvites(), 15_000);
  // Periodically re-assert the push subscription so a long-lived connection whose
  // subscription silently died (server-pruned endpoint, browser rotation the SW
  // missed) re-registers without waiting for a reconnect. Throttled internally.
  setInterval(() => void revalidatePushSubscription(), 6 * 60 * 60_000);
  // A profile edit (settings change) by a freshly-invited user → try to connect
  // to their inviter now that their name/photo may be complete.
  subscribe(['settings'], () => {
    if (getPendingInviter()) void maybePollInvites();
  });

  // Contacts changed (added/accepted/removed) → re-subscribe to their presence
  // and re-push the contact edges (debounced) so the presence audience stays
  // current on the server.
  let edgeTimer: ReturnType<typeof setTimeout> | undefined;
  subscribe(['contacts'], () => {
    void sendPresenceSub();
    if (edgeTimer) clearTimeout(edgeTimer);
    edgeTimer = setTimeout(() => void syncContactEdges(), 2000);
  });
  // Settings changed → re-upload presence sharing booleans, and reconcile the
  // push subscription with the "Show notifications" toggles (subscribe/drop).
  subscribe(['settings'], () => {
    void sendPresencePrefs();
    void applyPushPreference();
  });

  // Back up own data (contacts/chats + profile/prefs snapshot) shortly after any
  // change, not only on reconnect. Debounced so a burst of writes coalesces.
  let ownSyncTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleOwnSync = () => {
    if (!transport || transport.state !== 'online') return;
    // Ignore the change-bus echoes from ownsync's own cursor/watermark writes
    // (they live in the `settings` store), otherwise each sync triggers the
    // next one forever.
    if (ownSyncQuiet()) return;
    if (ownSyncTimer) clearTimeout(ownSyncTimer);
    ownSyncTimer = setTimeout(() => void runOwnSync(), 1500);
  };
  subscribe(['settings', 'contacts', 'chats'], scheduleOwnSync);

  // Accurate presence: report background/foreground transitions, and reconnect
  // promptly when the app is shown again or the network returns.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        nudgeReconnect();
        void verifySessionOrReset(); // returning to the app → confirm we're still valid
        // Re-poll peer lifecycle so a contact who terminated while we sat
        // connected flips to "Ghosted" on return (reconnect alone won't fire if
        // the socket stayed up). Cheap batch call; errors are swallowed.
        if (isUnlocked.value) void refreshContactStatuses();
        // Re-assert push on a warm reopen (no reconnect event fires), so a device
        // whose subscription silently lapsed while closed heals on foreground.
        // Throttled internally, so this is cheap to run every time.
        void revalidatePushSubscription();
      }
      void sendPresenceSelf(selfActive()); // online only when visible AND unlocked
    });
    // Best-effort "going away" as the tab is hidden/closed.
    window.addEventListener('pagehide', () => void sendPresenceSelf(false));
    window.addEventListener('online', () => nudgeReconnect());
  }

  // When the identity is created (e.g. just after registration) while already
  // connected, publish its prekey bundle so peers can reach us.
  watch(isInitialized, (ready) => {
    if (ready && syncState.value === 'online') void publishOwnPreKeysOnce();
  });

  // On unlock: settle (suppress a banner burst), decrypt anything that arrived
  // while locked, and run the master-key-dependent sync.
  watch(isUnlocked, (unlocked) => {
    void sendPresenceSelf(selfActive()); // lock → offline, unlock → online to peers
    if (!unlocked) return;
    deferNotificationsFor(2500); // a couple seconds to land before alerting
    void drainPendingIncoming(); // decrypt messages received behind the gate
    if (syncState.value === 'online') {
      void runOwnSync();
      void replenishPreKeysIfLow(); // needs the master key, so (re)run on unlock
      void runInviteSync(); // now unlocked → connect to our inviter / process redemptions
    }
  });

  // Connection follows auth: connect once registered, disconnect on sign-out.
  // The keystore lock does NOT close the relay; messages that arrive while
  // locked are acked (so the sender gets "delivered" as soon as the device has
  // it) and stashed as ciphertext; they're decrypted + surfaced only on unlock
  // (see receiveIncoming + drainPendingIncoming). Nothing is decrypted behind
  // the passcode gate.
  watch(
    isAuthenticated,
    (authed) => {
      if (!transport) return;
      const token = getToken();
      if (authed && token) {
        void transport.connect(token);
      } else {
        transport.disconnect();
        void disablePush(); // drop the push subscription on sign-out
        clearPresence();
      }
    },
    { immediate: true },
  );
}

// Message ids we've already sent a read receipt for (avoid resending on every
// chat open). In-memory is fine, a duplicate read receipt is idempotent.
const readReceiptsSent = new Set<string>();

/**
 * Send 'read' receipts for the incoming messages of a chat (called when the user
 * opens it). The server routes each receipt to its target and stamps `from` = the
 * reader, advancing that message's status to 'read' on the sender's side.
 *
 * 1:1: every unseen message goes to the single peer. Group: each message is
 * addressed to its OWN author (m.senderId); a group has N independent 1:1 relay
 * paths, not one peer, so the original sender's per-recipient receipt for us is
 * the one that gets stamped read (see applyReceipt's group aggregation).
 */
export async function sendReadReceipts(chatId: string): Promise<void> {
  if (!transport || transport.state !== 'online') return;
  const chat = await getChat(chatId);
  if (!chat) return;
  const peerUserId = chat.isGroup ? null : chat.participantIds[0];
  if (!chat.isGroup && !peerUserId) return;

  const msgs = await listMessages(chatId, '');
  for (const m of msgs) {
    if (m.outgoing || readReceiptsSent.has(m.id)) continue;
    // In a group the recipient is the message's author; in 1:1 it's the peer.
    const to = chat.isGroup ? m.senderId : peerUserId;
    if (!to || to === 'me') continue;
    readReceiptsSent.add(m.id);
    try {
      await transport.send({ t: 'receipt', messageId: m.id, status: 'read', at: Date.now(), to });
    } catch {
      readReceiptsSent.delete(m.id); // retry next time if the send failed
    }
  }
}

/**
 * Send a frame live over the transport, bypassing the durable outbox. Used for
 * call signalling, which is real-time: a frame that can't be delivered now is
 * useless (a missed call), so it must never be queued/redelivered like a chat
 * message. Returns false if offline (caller decides how to surface that).
 */
export async function sendLive(frame: Frame): Promise<boolean> {
  if (!transport || transport.state !== 'online') return false;
  try {
    await transport.send(frame);
    return true;
  } catch {
    return false;
  }
}

/** Whether the relay is currently connected (for call pre-flight checks). */
export function isTransportOnline(): boolean {
  return !!transport && transport.state === 'online';
}

// Poll redeemed invitations only when there's something to resolve (outstanding
// sent invites, or we ourselves were invited and haven't connected yet).
async function maybePollInvites(): Promise<void> {
  if (syncState.value !== 'online' || !isUnlocked.value) return;
  if (getPendingInviter() || (await listPendingInvites()).length > 0) {
    await runInviteSync();
  }
}

export function useSync() {
  start();
  return { syncState };
}
