<template>
  <ion-page>
    <ion-content :fullscreen="true" class="notif-content">
      <div class="notif-wrapper">
        <div class="notif-body">
          <div class="notif-logo">
            <ion-icon :icon="notificationsOutline" />
          </div>
          <h1 class="notif-title">Stay in the loop</h1>
          <p class="notif-subtitle">
            Enable notifications so you never miss a call or message, even when
            the app is closed.
          </p>
        </div>

        <div class="notif-actions ion-padding-horizontal">
          <ion-button
            expand="block"
            shape="round"
            class="primary-btn"
            :disabled="loading"
            @click="enable"
          >
            <ion-spinner v-if="loading" name="crescent" />
            <span v-else>Enable notifications</span>
          </ion-button>
          <ion-button expand="block" fill="clear" class="link-btn" @click="skip">
            Not now
          </ion-button>
        </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonPage, IonContent, IonButton, IonIcon, IonSpinner } from '@ionic/vue';
import { notificationsOutline } from 'ionicons/icons';
import { currentPermission, requestPushPermission } from '@/services/notifications';

const router = useRouter();
const loading = ref(false);

function proceed() {
  router.replace('/tabs/chats');
}

onMounted(() => {
  // If the user already granted (or the browser can't prompt), don't nag.
  const p = currentPermission();
  if (p === 'granted' || p === 'unsupported') proceed();
});

async function enable() {
  loading.value = true;
  try {
    await requestPushPermission();
  } finally {
    loading.value = false;
    proceed();
  }
}

function skip() {
  proceed();
}
</script>

<style scoped>
.notif-content {
  --background: radial-gradient(
      circle at 50% 0%,
      rgba(16, 185, 129, 0.18),
      transparent 55%
    ),
    var(--ion-background-color, #fff);
}

.notif-wrapper {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  padding: max(env(safe-area-inset-top), 24px) 0 max(env(safe-area-inset-bottom), 24px);
}

.notif-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  text-align: center;
  padding: 0 32px;
}

.notif-logo {
  width: 88px;
  height: 88px;
  border-radius: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ion-color-primary);
  box-shadow: 0 12px 32px rgba(16, 185, 129, 0.45);
  margin-bottom: 28px;
}

.notif-logo ion-icon {
  font-size: 44px;
  color: #fff;
}

.notif-title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.notif-subtitle {
  margin: 10px 0 0;
  color: var(--app-text-muted);
  font-size: 15px;
  line-height: 1.45;
  max-width: 300px;
}

.primary-btn {
  --background: var(--ion-color-primary);
  --box-shadow: 0 8px 24px rgba(16, 185, 129, 0.4);
  height: 52px;
  font-weight: 600;
  font-size: 16px;
}

.link-btn {
  --color: var(--app-text-muted);
  margin-top: 6px;
  font-weight: 500;
}
</style>
