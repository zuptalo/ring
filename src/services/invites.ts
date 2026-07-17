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
import { listInvitations, fetchDirectoryUser } from '@/services/api';
import { getPendingInviter, clearPendingInviter } from '@/services/auth';
import {
  requestFriend,
  acceptRequest,
  markAutoAccept,
  removePendingInvite,
  markInviteJoined,
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

    // The server marks a code "used" the instant the invitee picks a username — long
    // before they finish setting up. Arm the auto-accept + connection now (idempotent),
    // but hold the "X joined Ring" announcement until the invitee has actually FINISHED
    // their profile: a photo is required to finish, and they publish it to the directory
    // on completion, so a non-empty directory avatar is our "they tapped Start messaging"
    // signal. Until then, leave the code unhandled and re-check on the next sweep.
    await markAutoAccept(inv.usedBy); // auto-accept their request if/when it arrives
    await acceptRequest(inv.usedBy); // accept now if their card already arrived (else no-op)

    // The code is genuinely redeemed the instant the server reports `usedBy` (set
    // when the invitee picks a username). Drop it from the "Invited" waiting list NOW,
    // decoupled from whether they've finished their profile — previously the row was
    // held until a published avatar, so an invitee who registered but never set a
    // photo left it stuck as "Waiting to join" forever (you had to remove it by hand).
    // markInviteJoined only hides it from the list; the record (and your label)
    // survive so the announcement below can still name them by your label.
    await markInviteJoined(inv.code);

    // Hold the one-time "X joined Ring" announcement until they've actually FINISHED
    // setting up: a photo is required to finish and is published to the directory on
    // completion, so a non-empty directory avatar is our "they tapped Start" signal.
    let profile;
    try {
      profile = await fetchDirectoryUser(inv.usedBy);
    } catch {
      continue; // transient: re-check next sweep (already dropped from the list)
    }
    if (!profile?.avatar) continue; // profile not finished yet → don't announce

    const pending = await getPendingInvite(inv.code); // your label survives markInviteJoined
    await removePendingInvite(inv.code); // fully clean up now that we're announcing
    await markInviteHandled(inv.code); // announce exactly once

    // "Mom joined Ring": prefer our label, then their published/synced name. Shown as a
    // unified top banner ('system' kind) with an icon — same component as chat alerts.
    const name =
      pending?.label || profile.displayName || (await getContact(inv.usedBy))?.name || 'Someone';
    void notifyIncoming({ kind: 'system', name, body: 'joined Ring' });
  }
}

/** Run both sides, called on connect + unlock. */
export async function runInviteSync(): Promise<void> {
  await connectToInviter();
  await processSentInvitations();
}
