<template>
  <!-- Incoming-call ring: a NON-blocking banner at the top so you can keep using the
       app (e.g. finish a chat) while deciding. Accepting is the gesture that unlocks
       audio AND switches to the full-screen call screen. -->
  <div v-if="callState === 'incoming' && callMeta" class="ring-banner">
    <ion-avatar class="ring-avatar">
      <img :src="callMeta.avatar" :alt="callMeta.name" />
    </ion-avatar>
    <div class="ring-text">
      <div class="ring-name">{{ callMeta.name }}</div>
      <div class="ring-kind">
        {{ callMeta.isGroup ? 'Group · ' : '' }}Incoming {{ callMeta.kind === 'video' ? 'video' : 'voice' }} call…
      </div>
      <!-- Group calls mesh between everyone, so joining exposes you to the other
           participants — name them (and flag any you don't know) so accepting is
           informed consent. -->
      <div v-if="participantsLine" class="ring-with">{{ participantsLine }}</div>
    </div>
    <!-- Decline with a quick message (1:1 only): pick a canned reply, sent into the
         chat as we decline. Customizable under Settings > Calls. -->
    <button
      v-if="!callMeta.isGroup"
      class="ring-btn message"
      aria-label="Decline with message"
      @click="declineMenu"
    >
      <ion-icon :icon="chatbubbleEllipsesOutline" />
    </button>
    <button class="ring-btn decline" aria-label="Decline" @click="reject">
      <ion-icon :icon="callOutline" />
    </button>
    <button class="ring-btn accept" aria-label="Accept" @click="accept">
      <ion-icon :icon="callMeta.kind === 'video' ? videocamOutline : callOutline" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { IonAvatar, IonIcon, actionSheetController } from '@ionic/vue';
import { callOutline, videocamOutline, chatbubbleEllipsesOutline } from 'ionicons/icons';
import { callState, callMeta, acceptCall, rejectCall, declineWithMessage } from '@/composables/useCall';
import { getQuickDeclines } from '@/services/quick-declines';
import { getContact } from '@/db/queries';
import { getSelfUserId } from '@/services/auth';

// Resolve the other participants' names for the consent line. Re-runs whenever the ringing
// call changes; a co-participant who isn't a contact has no name and is counted as someone
// "you don't know" — the privacy-relevant case for an ad-hoc mesh call.
const others = ref<{ name: string }[]>([]);
watch(
  () => (callState.value === 'incoming' && callMeta.value?.isGroup ? callMeta.value?.roster : null),
  async (roster) => {
    const self = getSelfUserId() ?? '';
    const ids = (roster ?? []).filter((id) => id && id !== self);
    others.value = await Promise.all(ids.map(async (id) => ({ name: (await getContact(id))?.name ?? '' })));
  },
  { immediate: true },
);

function joinNames(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const participantsLine = computed(() => {
  const list = others.value;
  if (!list.length) return '';
  const known = list.filter((o) => o.name).map((o) => o.name);
  const unknown = list.length - known.length;
  const parts = [...known];
  if (unknown > 0) parts.push(unknown === 1 ? 'someone you don’t know' : `${unknown} people you don’t know`);
  return `With ${joinNames(parts)}`;
});

function accept(): void {
  void acceptCall();
}
function reject(): void {
  void rejectCall();
}
async function declineMenu(): Promise<void> {
  const replies = await getQuickDeclines();
  const sheet = await actionSheetController.create({
    header: 'Decline with a message',
    buttons: [
      ...replies.map((text) => ({ text, handler: () => void declineWithMessage(text) })),
      { text: 'Decline without message', role: 'destructive', handler: () => void rejectCall() },
      { text: 'Cancel', role: 'cancel' },
    ],
  });
  await sheet.present();
}
</script>

<style scoped>
.ring-banner {
  position: fixed;
  top: max(8px, env(safe-area-inset-top));
  left: 10px;
  right: 10px;
  max-width: 560px;
  margin: 0 auto;
  z-index: 20000; /* above content + the notification banners */
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 18px;
  color: #fff;
  background: #0a7d5c; /* app green; an incoming call is a "go" action */
  backdrop-filter: blur(16px);
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.4);
  animation: ring-in 0.22s ease;
}
@keyframes ring-in {
  from {
    opacity: 0;
    transform: translateY(-12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.ring-avatar {
  flex: none;
  width: 44px;
  height: 44px;
  border: 2px solid rgba(255, 255, 255, 0.8);
}
.ring-text {
  flex: 1;
  min-width: 0;
}
.ring-name {
  font-weight: 700;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ring-kind {
  font-size: 13px;
  opacity: 0.9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ring-with {
  font-size: 12px;
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ring-btn {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 21px;
  color: #fff;
  cursor: pointer;
}
.ring-btn ion-icon {
  font-size: 21px;
}
.message {
  /* Smaller, subtler than decline/accept: a secondary "reply instead" affordance. */
  width: 38px;
  height: 38px;
  background: rgba(255, 255, 255, 0.18);
}
.message ion-icon {
  font-size: 18px;
}
.decline {
  background: var(--ion-color-danger, #eb445a);
  transform: rotate(135deg);
}
.accept {
  background: #fff;
  color: #0a7d5c;
}
</style>
