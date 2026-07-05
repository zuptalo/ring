<template>
  <div class="contact-card">
    <ion-avatar class="contact-av">
      <user-avatar :src="avatar" :alt="contact.name" />
    </ion-avatar>
    <div class="contact-meta">
      <span class="contact-name">{{ contact.name }}</span>
      <span class="contact-sub">Ring contact</span>
    </div>
    <ion-button class="contact-msg" size="small" fill="clear" @click.stop="$emit('message')">
      Message
    </ion-button>
  </div>
</template>

<script setup lang="ts">
import UserAvatar from '@/components/UserAvatar.vue';
import { computed } from 'vue';
import { IonAvatar, IonButton } from '@ionic/vue';
import { initialsAvatar } from '@/db/avatars';
import type { SharedContact } from '@/db/types';

const props = defineProps<{ contact: SharedContact }>();
defineEmits<{ (e: 'message'): void }>();
const avatar = computed(() => props.contact.avatar || initialsAvatar(props.contact.name));
</script>

<style scoped>
.contact-card {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 240px;
  max-width: 100%;
  padding: 4px 2px;
}
.contact-av {
  width: 44px;
  height: 44px;
  flex: none;
}
.contact-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.contact-name {
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.contact-sub {
  font-size: 12px;
  color: var(--app-text-muted);
}
.contact-msg {
  flex: none;
  margin: 0;
  --padding-start: 8px;
  --padding-end: 8px;
}
</style>
