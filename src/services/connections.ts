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
  listConnections, connectRequest, connectAccept, connectReject, connectLink as apiLink,
  fetchDirectoryUser,
} from '@/services/api';
import { importDirectoryUser } from '@/services/directory';
import { getContact } from '@/db/queries';

export interface ConnItem {
  userId: string;
  name: string;
  avatar: string;
  state: string;
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
  let data: { incoming: { requester: string }[]; outgoing: { target: string; state: string }[] };
  try {
    data = await listConnections();
  } catch {
    return;
  }
  incomingRequests.value = await Promise.all(
    data.incoming.map(async (r) => ({ userId: r.requester, ...(await hydrate(r.requester)), state: 'pending' })),
  );
  outgoingRequests.value = await Promise.all(
    data.outgoing.map(async (r) => ({ userId: r.target, ...(await hydrate(r.target)), state: r.state })),
  );
}

/** Send a connect request to a directory user (and save them as a contact so we can
 *  message once accepted). Returns the resulting state. */
export async function requestConnect(userId: string): Promise<string> {
  const state = await connectRequest(userId);
  await importDirectoryUser(userId); // so their profile is on hand once accepted
  await refreshConnections();
  return state;
}

/** Accept an incoming request: connect + add them as a contact (so a chat can start). */
export async function acceptConnect(userId: string): Promise<void> {
  await connectAccept(userId);
  await importDirectoryUser(userId);
  await refreshConnections();
}

/** Reject (optionally + block) an incoming request. */
export async function rejectConnect(userId: string, block: boolean): Promise<void> {
  await connectReject(userId, block);
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
