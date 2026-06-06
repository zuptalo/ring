/**
 * Invitation auto-connect. Bridges the invite-code flow to contacts:
 *  - The INVITEE, on first unlock, sends a friend request to whoever invited
 *    them (captured at registration). Being the sole initiator avoids any
 *    session-setup race.
 *  - The INVITER polls their created codes; when one is redeemed, it auto-accepts
 *    the redeemer (now or when their request lands) and clears the pending-invite
 *    placeholder. No manual Accept tap on either side.
 *
 * Reuses the existing friend-request machinery (requestFriend / acceptRequest),
 * so there is no new crypto handshake.
 */
import { ref } from 'vue';
import { listInvitations } from '@/services/api';
import { getPendingInviter, clearPendingInviter } from '@/services/auth';
import {
  requestFriend,
  acceptRequest,
  markAutoAccept,
  removePendingInvite,
  isLinkedOrRequested,
  getPendingInvite,
  isInviteHandled,
  markInviteHandled,
  getContact,
  profileComplete,
} from '@/db/queries';
import { notifyIncoming } from '@/services/notify';
import { importDirectoryUser } from '@/services/directory';

// True when we were invited but can't introduce ourselves yet because our
// profile (name + photo) isn't set. App.vue watches this to route the new user
// to profile setup so the inviter doesn't see them as "You" with no image.
export const inviteNeedsProfile = ref(false);

// Synchronous reentrancy guard: connectToInviter can be triggered from several
// places (unlock, online, the poll), and without this they could overlap and send
// two request cards, desyncing the per-peer ratchet.
let connecting = false;

/** Invitee side: connect to whoever invited us (once unlocked). Single-shot. */
async function connectToInviter(): Promise<void> {
  const inviter = getPendingInviter();
  if (!inviter || connecting) return;
  connecting = true; // set BEFORE any await so concurrent triggers can't double-send
  try {
    // Don't introduce ourselves with an incomplete profile; wait until the user
    // has set a name + photo (they're prompted to). The flag keeps retrying.
    if (!(await profileComplete())) {
      inviteNeedsProfile.value = true;
      return;
    }
    inviteNeedsProfile.value = false;
    // Pull the inviter from the directory first (their name/avatar + auto-connect),
    // so we never show them as a bare id even before our card exchange settles.
    await importDirectoryUser(inviter);
    if (!(await isLinkedOrRequested(inviter))) {
      await requestFriend(inviter);
    }
    clearPendingInviter(); // success → don't retry (and don't re-send)
  } catch (e) {
    console.warn('[invite] connect to inviter failed (will retry)', e); // keep flag set
  } finally {
    connecting = false;
  }
}

/** Inviter side: detect redeemed codes and auto-connect to the redeemers. */
async function processSentInvitations(): Promise<void> {
  let invites;
  try {
    invites = await listInvitations();
  } catch {
    return; // offline / transient, retried on the next sync
  }
  for (const inv of invites) {
    if (!inv.usedBy) continue;
    if (await isInviteHandled(inv.code)) continue; // already connected + notified

    // Read the label before we clear the placeholder, for the notification.
    const pending = await getPendingInvite(inv.code);

    await markAutoAccept(inv.usedBy); // auto-accept when their request arrives
    await acceptRequest(inv.usedBy); // accept now if it already arrived (no-op otherwise)
    await removePendingInvite(inv.code); // the placeholder becomes a real contact
    await markInviteHandled(inv.code); // fire the notification only once

    // "Mom joined Ring": prefer the label, fall back to their synced profile.
    const name = pending?.label || (await getContact(inv.usedBy))?.name || 'Someone';
    void notifyIncoming({ kind: 'request', name, body: 'joined Ring' });
  }
}

/** Run both sides, called on connect + unlock. */
export async function runInviteSync(): Promise<void> {
  await connectToInviter();
  await processSentInvitations();
}
