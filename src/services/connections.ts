/**
 * Client side of the server-enforced connect-request gate. The server is the source
 * of truth (GET /v1/connections); this keeps a small reactive view of incoming
 * (awaiting our accept) and outgoing (requested / rejected) requests for the UI, and
 * exposes the request / accept / reject / link actions.
 *
 * `connectLink` is the group path: being in a group is consent, so we unilaterally
 * connect to co-members (so fan-out can fetch their bundles under the gate).
 */
import { ref } from 'vue';
import {
  listConnections, connectRequest, connectAccept, connectReject, connectWithdraw, connectLink as apiLink,
  fetchDirectoryUser,
} from '@/services/api';
import { importDirectoryUser } from '@/services/directory';
import { getContact, markContactConnected } from '@/db/queries';

export interface ConnItem {
  userId: string;
  name: string;
  avatar: string;
  state: string;
  /** When the request was last updated (ms epoch, from the server), for "2h ago". */
  updatedMs: number;
}

export const incomingRequests = ref<ConnItem[]>([]);
export const outgoingRequests = ref<ConnItem[]>([]);

/** Display name + avatar for a request, from a local contact or (read-only) the
 *  directory, without saving them as a contact. */
async function hydrate(userId: string): Promise<{ name: string; avatar: string }> {
  const c = await getContact(userId);
  if (c) return { name: c.name, avatar: c.avatar };
  try {
    const u = await fetchDirectoryUser(userId);
    if (u) return { name: u.displayName || (u.username ? `@${u.username}` : 'Someone'), avatar: u.avatar || '' };
  } catch {
    /* fall through */
  }
  return { name: 'Someone', avatar: '' };
}

/** Reconcile the reactive request lists from the server. Safe to call on connect and
 *  whenever a connect-req / connect-update frame arrives. */
export async function refreshConnections(): Promise<void> {
  let data: Awaited<ReturnType<typeof listConnections>>;
  try {
    data = await listConnections();
  } catch {
    return;
  }
  incomingRequests.value = await Promise.all(
    data.incoming.map(async (r) => ({
      userId: r.requester,
      ...(await hydrate(r.requester)),
      state: 'pending',
      updatedMs: r.updatedAt,
    })),
  );
  outgoingRequests.value = await Promise.all(
    data.outgoing.map(async (r) => ({
      userId: r.target,
      ...(await hydrate(r.target)),
      state: r.state,
      updatedMs: r.updatedAt,
    })),
  );
}

/** Request friendship with a directory user. A plain pending request creates NO
 *  local contact — they're not a friend yet (they show under outgoing requests,
 *  hydrated read-only from the directory). Only a mutual 'accepted' (they had
 *  already requested us) makes them a friend right away. Returns the state. */
export async function requestConnect(userId: string): Promise<string> {
  const state = await connectRequest(userId);
  if (state === 'accepted') {
    await importDirectoryUser(userId); // now a friend → save their profile
    await markContactConnected(userId);
  }
  await refreshConnections();
  return state;
}

/** Accept an incoming request: now a friend → import their profile as a contact and
 *  mark connected (so a chat can start; the server already recorded the accept). */
export async function acceptConnect(userId: string): Promise<void> {
  await connectAccept(userId);
  await importDirectoryUser(userId);
  await markContactConnected(userId);
  await refreshConnections();
}

/** Reject (optionally + block) an incoming request. */
export async function rejectConnect(userId: string, block: boolean): Promise<void> {
  await connectReject(userId, block);
  await refreshConnections();
}

/** Our outgoing request was accepted (a connect-update frame arrived). They're a
 *  friend now: import their profile as a contact + mark connected (we no longer
 *  auto-import the directory), then reconcile the request lists. */
export async function onConnectionAccepted(userId: string): Promise<void> {
  await importDirectoryUser(userId);
  await markContactConnected(userId);
  await refreshConnections();
}

/** Withdraw (cancel) an outgoing request we sent: removes it server-side so it
 *  leaves the other party's incoming list too. */
export async function withdrawConnect(userId: string): Promise<void> {
  await connectWithdraw(userId);
  await refreshConnections();
}

/** Unilaterally connect to a group co-member (membership = consent). Best-effort. */
export async function linkConnect(userId: string): Promise<void> {
  try {
    await apiLink(userId);
  } catch {
    /* best effort; a later interaction retries */
  }
}
