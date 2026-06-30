<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>Contacts</ion-title>
        <ion-buttons slot="end">
          <ion-button aria-label="Add contact" @click="connect">
            <ion-icon slot="icon-only" :icon="personAddOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-searchbar
          :value="search"
          placeholder="Search"
          @ion-input="search = $event.detail.value ?? ''"
        />
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <!-- Pull down to refresh: re-pull pending/accepted connection state AND any friend's
           latest name/avatar from the directory (changes otherwise only land opportunistically). -->
      <ion-refresher slot="fixed" @ion-refresh="onPullRefresh">
        <ion-refresher-content pulling-text="Pull to refresh requests &amp; friends" refreshing-text="Refreshing…" />
      </ion-refresher>
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">Contacts</ion-title>
        </ion-toolbar>
      </ion-header>

      <!-- Always-available entry point to grow your network by browsing the public
           directory. Pinned to the top of Contacts so it's reachable at any time. -->
      <ion-list class="browse-list">
        <ion-item button :detail="true" lines="full" @click="router.push('/directory')">
          <ion-icon slot="start" :icon="compassOutline" color="primary" />
          <ion-label>
            <h2>Browse user directory</h2>
            <p>Find people to chat with on Ring</p>
          </ion-label>
        </ion-item>
      </ion-list>

      <!-- Friend requests: incoming (Accept/Decline) + outgoing pending (Cancel),
           one section, sourced from the connections store with timestamps (0002). -->
      <ion-list v-if="incomingRequests.length || pendingOutgoing.length">
        <ion-list-header>
          <ion-label>Friend requests</ion-label>
        </ion-list-header>
        <ion-item v-for="req in incomingRequests" :key="`in-${req.userId}`" :detail="false">
          <ion-avatar slot="start">
            <img :src="req.avatar || initialsAvatar(req.name)" :alt="req.name" />
          </ion-avatar>
          <ion-label class="ion-text-wrap">
            <h2>{{ req.name }}</h2>
            <p>wants to be friends · {{ formatStamp(req.updatedMs) }}</p>
          </ion-label>
          <ion-button slot="end" fill="solid" size="small" @click="acceptConn(req.userId)">Accept</ion-button>
          <ion-button slot="end" fill="clear" size="small" color="medium" @click="rejectConn(req)">Decline</ion-button>
        </ion-item>
        <ion-item v-for="req in pendingOutgoing" :key="`out-${req.userId}`" :detail="false">
          <ion-avatar slot="start">
            <img :src="req.avatar || initialsAvatar(req.name)" :alt="req.name" />
          </ion-avatar>
          <ion-label class="ion-text-wrap">
            <h2>{{ req.name }}</h2>
            <p>Requested · {{ formatStamp(req.updatedMs) }}</p>
          </ion-label>
          <!-- Cancel → confirm → server withdraw, retracting it from their inbox
               (spec 0002 FR-008). -->
          <ion-button slot="end" fill="clear" size="small" color="medium" @click="cancelConn(req)">Cancel</ion-button>
        </ion-item>
      </ion-list>

      <ion-list v-if="groupInvites.length">
        <ion-list-header>
          <ion-label>Invitations</ion-label>
        </ion-list-header>
        <ion-item v-for="inv in groupInvites" :key="inv.id" :detail="false">
          <ion-avatar slot="start">
            <img :src="inv.avatar" :alt="inv.name || 'Group'" />
          </ion-avatar>
          <ion-label>
            <h2>{{ inv.name || inv.memberPreview || 'Group' }}</h2>
            <p>Group invitation{{ inv.memberPreview ? ' · ' + inv.memberPreview : '' }}</p>
          </ion-label>
          <ion-button slot="end" fill="solid" size="small" @click="acceptInvite(inv.groupId)">
            Accept
          </ion-button>
          <ion-button slot="end" fill="clear" size="small" color="medium" @click="declineInvite(inv.groupId)">
            Decline
          </ion-button>
        </ion-item>
      </ion-list>

      <ion-list v-if="invited.length">
        <ion-list-header>
          <ion-label>Invited</ion-label>
        </ion-list-header>
        <ion-item v-for="inv in invited" :key="inv.code" :detail="false">
          <ion-avatar slot="start">
            <img :src="initialsAvatar(inv.label || 'Invite')" :alt="inv.label || 'Invite'" />
          </ion-avatar>
          <ion-label>
            <h2>{{ inv.label || 'Unnamed invite' }}</h2>
            <p :class="{ expired: isExpired(inv.code) }">{{ inviteStatus(inv.code) }}</p>
          </ion-label>
          <ion-button
            slot="end"
            fill="clear"
            size="small"
            color="medium"
            aria-label="Invite options"
            @click="inviteActions(inv)"
          >
            <ion-icon slot="icon-only" :icon="ellipsisHorizontal" />
          </ion-button>
        </ion-item>
      </ion-list>

      <ion-list>
        <ion-list-header v-if="friends.length">
          <ion-label>Friends</ion-label>
        </ion-list-header>
        <template v-for="group in groups" :key="group.letter">
          <ion-item-divider sticky>
            <ion-label>{{ group.letter }}</ion-label>
          </ion-item-divider>
          <ion-item-sliding v-for="person in group.people" :key="person.id">
            <ion-item button :detail="false" @click="open(person.id)">
              <div class="avatar-wrap" slot="start">
                <ion-avatar>
                  <img :src="person.avatar" :alt="person.name" />
                </ion-avatar>
                <span v-if="peerPresence(person.id)?.online" class="presence-dot" aria-hidden="true" />
              </div>
              <ion-label>
                <h2>{{ person.name }}</h2>
                <p>{{ person.about }}</p>
              </ion-label>
            </ion-item>
            <ion-item-options side="end">
              <ion-item-option color="danger" @click="removeContact(person.id)">
                <ion-icon slot="icon-only" :icon="trashOutline" />
              </ion-item-option>
            </ion-item-options>
          </ion-item-sliding>
        </template>

        <!-- Blocked contacts live at the bottom, out of the way and easy to spot.
             Tapping opens the contact where they can be unblocked. -->
        <template v-if="blockedContacts.length">
          <ion-list-header>
            <ion-label>Blocked</ion-label>
          </ion-list-header>
          <ion-item
            v-for="person in blockedContacts"
            :key="`blocked-${person.id}`"
            button
            :detail="false"
            class="blocked-row"
            @click="open(person.id)"
          >
            <ion-avatar slot="start">
              <img :src="person.avatar" :alt="person.name" />
            </ion-avatar>
            <ion-label>
              <h2>{{ person.name }}</h2>
              <p>Blocked</p>
            </ion-label>
            <ion-icon slot="end" :icon="banOutline" color="medium" />
          </ion-item>
        </template>
      </ion-list>

      <ion-infinite-scroll
        :disabled="visible >= friends.length"
        @ion-infinite="loadMore"
      >
        <ion-infinite-scroll-content />
      </ion-infinite-scroll>

      <div v-if="loaded && contacts.length === 0" class="empty">
        <ion-note>No friends yet</ion-note>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
  IonIcon, IonSearchbar, IonContent, IonList, IonListHeader, IonItem,
  IonItemDivider, IonAvatar, IonLabel, IonNote,
  IonInfiniteScroll, IonInfiniteScrollContent,
  IonItemSliding, IonItemOptions, IonItemOption,
  IonRefresher, IonRefresherContent,
  actionSheetController, alertController, onIonViewWillEnter,
} from '@ionic/vue';
import type { InfiniteScrollCustomEvent, RefresherCustomEvent } from '@ionic/vue';
import { refreshContactProfiles } from '@/services/directory';
import { personAddOutline, trashOutline, ellipsisHorizontal, compassOutline, banOutline } from 'ionicons/icons';
import {
  incomingRequests, outgoingRequests, acceptConnect, rejectConnect, withdrawConnect, refreshConnections,
  type ConnItem,
} from '@/services/connections';
import { appToast } from '@/services/toast';
import { formatStamp } from '@/utils/time';
import {
  deleteContact, listContacts,
  listPendingInvites, cancelSentInvite, type PendingInvite,
  listGroupInvites, acceptGroupInvite, declineGroupInvite,
} from '@/db/queries';
import { listInvitations, extendInvitation, type ServerInvitation } from '@/services/api';
import { initialsAvatar } from '@/db/avatars';
import type { Contact, FriendRequest } from '@/db/types';
import { useLiveQuery } from '@/composables/useLiveQuery';
import { warmContacts, warmContactsLoaded, warmWhenIdle } from '@/composables/warmStores';
import { useConnect } from '@/composables/useConnect';
import { peerPresence } from '@/composables/usePresence';

const PAGE = 15;
const router = useRouter();

// Pull-to-refresh: re-pull connection state (pending/accepted requests) and refresh every
// friend's name/avatar from the directory, in parallel; release when both settle.
async function onPullRefresh(e: RefresherCustomEvent): Promise<void> {
  try {
    await Promise.all([refreshConnections(), refreshContactProfiles()]);
  } finally {
    void e.detail.complete();
  }
}
const open = (id: string) => router.push(`/contact/${id}`);
const removeContact = async (id: string): Promise<void> => {
  try {
    await deleteContact(id);
  } catch {
    void appToast({ message: 'Could not delete. Try again.', duration: 1500, color: 'danger' });
  }
};

// Shared add-contact flow (also used by the New-chat modal).
const { connect } = useConnect();

const search = ref('');
const visible = ref(PAGE);
const contacts = useLiveQuery(
  () => listContacts(search.value),
  ['contacts', 'chats'], // listContacts hides contacts whose 1:1 chat is pending
  [] as Contact[],
  () => search.value,
  // Empty search → seed first paint from the warm contacts store; a typed term
  // falls back to the live query (spec 1001 "Search contract").
  warmWhenIdle(warmContacts, warmContactsLoaded, search),
);
// Gate the empty state so "No contacts found" only shows once data has resolved
// (true immediately when seeded from the warm store), never as a flash (FR-006).
const loaded = contacts.loaded;
// Reset the page window when the search term changes.
watch(search, () => (visible.value = PAGE));

// Outgoing friend requests still awaiting a response (pending only). Rejected ones
// drop out of the list — the person becomes discoverable in the directory again.
const pendingOutgoing = computed(() => outgoingRequests.value.filter((r) => r.state === 'pending'));

// Incoming group invitations (accept-first): accepting creates the group chat and
// starts receiving from that point; declining tells the inviter and clears it.
const groupInvites = useLiveQuery(
  () => listGroupInvites(),
  ['requests'],
  [] as FriendRequest[],
);
const acceptInvite = (groupId?: string) => groupId && acceptGroupInvite(groupId);
const declineInvite = (groupId?: string) => groupId && declineGroupInvite(groupId);

// Pending invitations (codes you've sent, awaiting the person to join). The label
// is local; the expiry/redemption state comes from the server (fetched below).
const invited = useLiveQuery(
  () => listPendingInvites(),
  ['settings'],
  [] as PendingInvite[],
);

// Server-side invite state by code (expiry, used). Fetched on enter; the `now`
// ticker re-renders the countdown without refetching.
const serverInvites = ref(new Map<string, ServerInvitation>());
const now = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval> | undefined;

async function refreshServerInvites(): Promise<void> {
  try {
    const list = await listInvitations();
    const m = new Map<string, ServerInvitation>();
    for (const inv of list) m.set(inv.code, inv);
    serverInvites.value = m;
  } catch {
    /* offline / transient - keep whatever we have */
  }
}

function expiresAt(code: string): number | undefined {
  return serverInvites.value.get(code)?.expiresAt;
}
function isExpired(code: string): boolean {
  const exp = expiresAt(code);
  return exp !== undefined && exp <= now.value;
}
// Status line under each invite's name.
function inviteStatus(code: string): string {
  const exp = expiresAt(code);
  if (exp === undefined) return 'Waiting to join'; // offline / legacy never-expiring
  const left = exp - now.value;
  if (left <= 0) return 'Expired';
  const min = Math.floor(left / 60_000);
  if (min < 60) return `Expires in ${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `Expires in ${hr} hour${hr === 1 ? '' : 's'}`;
  return `Expires in ${Math.floor(hr / 24)} days`;
}

async function toast(message: string): Promise<void> {
  await appToast({ message, duration: 1800 });
}

async function inviteActions(inv: PendingInvite): Promise<void> {
  const expired = isExpired(inv.code);
  const sheet = await actionSheetController.create({
    header: inv.label || 'Invitation',
    buttons: [
      {
        text: expired ? 'Reactivate for 24 hours' : 'Extend by 24 hours',
        handler: () => void doExtend(inv.code),
      },
      { text: 'Cancel invite', role: 'destructive', handler: () => void doCancel(inv.code) },
      { text: 'Close', role: 'cancel' },
    ],
  });
  await sheet.present();
}

async function doExtend(code: string): Promise<void> {
  try {
    const exp = await extendInvitation(code);
    const prev = serverInvites.value.get(code);
    const next = new Map(serverInvites.value);
    next.set(code, { code, createdAt: prev?.createdAt ?? Date.now(), usedBy: prev?.usedBy ?? '', expiresAt: exp });
    serverInvites.value = next;
    void toast('Extended by 24 hours.');
  } catch (e) {
    void toast(e instanceof Error ? e.message : 'Could not extend the invite.');
  }
}

async function doCancel(code: string): Promise<void> {
  const serverOk = await cancelSentInvite(code); // server + local; list updates via live query
  const next = new Map(serverInvites.value);
  next.delete(code);
  serverInvites.value = next;
  // If the server delete didn't go through (offline/transient), be honest that the
  // code may still be redeemable until it expires, rather than implying it's dead.
  void toast(serverOk ? 'Invite cancelled.' : 'Removed from your list. The code may still work until it expires.');
}

// Connect-request actions (the connection store reconciles via WS frames + connect).
async function acceptConn(userId: string): Promise<void> {
  await acceptConnect(userId);
}
// Cancel an outgoing request → confirm first, then authoritative server withdraw
// (retracts it from the other party's incoming list, spec 0002 FR-008).
async function cancelConn(req: ConnItem): Promise<void> {
  const alert = await alertController.create({
    header: 'Cancel friend request?',
    message: `Withdraw your request to ${req.name}? They won't see it anymore.`,
    buttons: [
      { text: 'Keep', role: 'cancel' },
      { text: 'Cancel request', role: 'destructive', handler: () => void withdrawConnect(req.userId) },
    ],
  });
  await alert.present();
}
async function rejectConn(req: ConnItem): Promise<void> {
  const sheet = await actionSheetController.create({
    header: req.name,
    buttons: [
      { text: 'Decline', handler: () => void rejectConnect(req.userId, false) },
      { text: 'Decline and block', role: 'destructive', handler: () => void rejectConnect(req.userId, true) },
      { text: 'Cancel', role: 'cancel' },
    ],
  });
  await sheet.present();
}

onMounted(() => {
  void refreshServerInvites();
  void refreshConnections();
  nowTimer = setInterval(() => (now.value = Date.now()), 30_000);
});
onUnmounted(() => clearInterval(nowTimer));
onIonViewWillEnter(() => {
  void refreshServerInvites();
  void refreshConnections();
});

function loadMore(ev: InfiniteScrollCustomEvent) {
  visible.value += PAGE;
  ev.target.complete();
}

// Group the visible (already sorted) contacts by first letter for the headers.
// Active friends (alphabetical groups) vs. blocked contacts, which drop to their own
// section at the bottom so they're easy to find and out of the way.
const friends = computed(() => contacts.value.filter((c) => !c.blocked));
const blockedContacts = computed(() => contacts.value.filter((c) => c.blocked));
const groups = computed(() => {
  const map = new Map<string, Contact[]>();
  for (const c of friends.value.slice(0, visible.value)) {
    const letter = (c.name[0] ?? '#').toUpperCase();
    if (!map.has(letter)) map.set(letter, []);
    map.get(letter)!.push(c);
  }
  return [...map.entries()].map(([letter, people]) => ({ letter, people }));
});
</script>

<style scoped>
/* Pinned "Browse user directory" row sits flush above the requests/contacts lists. */
.browse-list {
  padding-top: 0;
}
.browse-list ion-icon {
  font-size: 24px;
}
.empty {
  text-align: center;
  margin-top: 40px;
}
/* Online indicator overlaid on the avatar (trivial layout CSS). */
.avatar-wrap {
  position: relative;
}
.presence-dot {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--ion-color-success, #2dd36f);
  border: 2px solid var(--ion-background-color, #fff);
}
/* An expired invite's status line stands out so it's clear an extend is needed. */
p.expired {
  color: var(--ion-color-danger, #eb445a);
}
</style>
