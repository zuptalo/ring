<template>
  <!-- Full-screen install gate. Like KeyGuard, this overlays the (always-mounted)
       router outlet as an opaque ion-page, so a plain browser tab can't be used
       until Ring is installed to the Home Screen. -->
  <ion-page v-if="mustInstall">
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>Install Ring</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <!-- Constrain to a centered column so it isn't stretched edge-to-edge on
           desktop / wide viewports. -->
      <div class="install-wrap">
      <!-- Brand block, matching the Auth page exactly. -->
      <div class="ion-text-center ion-padding">
        <div
          style="
            width: 76px;
            height: 76px;
            margin: 0 auto 20px;
            border-radius: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--ion-color-primary);
            box-shadow: 0 12px 32px rgba(16, 185, 129, 0.45);
          "
        >
          <svg viewBox="0 0 100 100" width="58" height="58" aria-hidden="true">
            <path
              style="fill: #fff;"
              d="M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z"
            />
            <circle
              cx="50"
              cy="49"
              r="18"
              style="fill: none; stroke: var(--ion-color-primary); stroke-width: 7;"
            />
          </svg>
        </div>
        <ion-text>
          <h1>Ring</h1>
        </ion-text>
        <ion-text color="medium">
          <p>For reliable notifications and your security, add Ring to your Home Screen to continue.</p>
        </ion-text>
      </div>

      <!-- Embedded in-app browser (Android WebView): it has no "Install app" path, so
           give accurate guidance to open Ring in a real browser app rather than the
           (wrong) "update Chrome" advice. Shown only for a true WebView, never merely
           because beforeinstallprompt was slow on a capable browser (spec 2003). -->
      <div v-if="platform === 'android' && installUnavailable" class="ion-padding">
        <div class="cant-install">
          <ion-icon :icon="warningOutline" />
          <span>
            You’ve opened Ring inside another app’s browser, which can’t install apps.
            Tap the ⋮ menu and choose “Open in Chrome” (or your browser app), then install
            Ring from there.
          </span>
        </div>
      </div>

      <!-- Firefox on Android can't install Ring as a real app (no install prompt, and its
           "Add to Home screen" only makes a shortcut that reopens in Firefox), so the gate
           would never clear and notifications stay unreliable. Steer to Chrome / Samsung
           Internet, where the WebAPK install works. -->
      <div v-if="platform === 'android' && firefoxAndroid && !installUnavailable" class="ion-padding">
        <div class="cant-install">
          <ion-icon :icon="warningOutline" />
          <span>
            Firefox on Android can’t install Ring as an app, so notifications won’t work
            reliably here. Open <strong>ring.zuptalo.com</strong> in Chrome or Samsung
            Internet, then follow the steps below to install.
          </span>
        </div>
      </div>

      <!-- Native install button (Chromium / Android, when available). -->
      <div v-if="canPrompt" class="ion-padding">
        <ion-button expand="block" shape="round" @click="install">
          <ion-icon slot="start" :icon="downloadOutline" />
          Install Ring
        </ion-button>
      </div>

      <!-- Platform-specific manual steps. -->
      <ion-list :inset="true">
        <ion-list-header>
          <ion-label>How to install</ion-label>
        </ion-list-header>
        <ion-item v-for="(step, i) in steps" :key="i" lines="none">
          <!-- Identical 24px marker wrapper for every row so Ionic spaces the
               start slot consistently and the labels line up. The icon/badge/SVG
               live inside it. -->
          <div slot="start" class="step-marker">
            <!-- Ring's app icon, what the user taps on the Home Screen. -->
            <svg v-if="step.glyph === 'ring'" class="step-glyph" viewBox="0 0 100 100" aria-hidden="true">
              <rect x="0" y="0" width="100" height="100" rx="22" style="fill: var(--ion-color-primary);" />
              <g transform="translate(8.98,8.16) scale(0.82)">
                <path style="fill: #fff;" d="M50 8 L88 21 V52 C88 72 72 87 50 94 C28 87 12 72 12 52 V21 Z" />
                <circle cx="50" cy="49" r="18" style="fill: none; stroke: var(--ion-color-primary); stroke-width: 7;" />
              </g>
            </svg>
            <!-- "Add to Home Screen": a plus inside a rounded rectangle. -->
            <svg v-else-if="step.glyph === 'addhome'" class="step-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" style="fill: none; stroke: var(--ion-color-primary); stroke-width: 1.7;" />
              <path d="M12 8.5 V15.5 M8.5 12 H15.5" style="stroke: var(--ion-color-primary); stroke-width: 1.7; stroke-linecap: round;" />
            </svg>
            <ion-icon v-else-if="step.icon" class="step-glyph" :icon="step.icon" color="primary" />
            <ion-note v-else class="step-num">{{ i + 1 }}</ion-note>
          </div>
          <ion-label class="ion-text-wrap">{{ step.text }}</ion-label>
        </ion-item>
      </ion-list>

      <!-- Some Android devices block the installed app via Play Protect ("unsafe" /
           "built for an older version of Android"). That's a Chrome/Play-Protect quirk with
           installed web apps — the WebAPK shell's target SDK is Google's, not Ring's — so we
           can't fix it in the app; instead, guide the user. Shown only on a real Android
           browser that can install (not iOS/desktop, not the in-app-browser callout above). -->
      <div v-if="platform === 'android' && !installUnavailable" class="ion-padding">
        <div class="install-help">
          <ion-icon :icon="informationCircleOutline" />
          <span>
            If Android says Ring is “unsafe” or “built for an older version of Android,”
            that’s a Google Play Protect quirk with installed web apps, not a problem with
            Ring. Tap “Install anyway” (not “OK,” which cancels) to continue. If you don’t
            see that option, update Chrome and Google Play services and try again.
          </span>
        </div>
      </div>

      <div class="ion-padding ion-text-center">
        <ion-text color="medium">
          <p>Already added it? Open Ring from your Home Screen.</p>
        </ion-text>
      </div>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent,
  IonText, IonButton, IonIcon, IonList, IonListHeader, IonItem, IonLabel, IonNote,
} from '@ionic/vue';
import { downloadOutline, shareOutline, warningOutline, informationCircleOutline } from 'ionicons/icons';
import { useInstallGuard, promptInstall } from '@/composables/useInstallGuard';

const { mustInstall, platform, canPrompt, installUnavailable, firefoxAndroid } = useInstallGuard();

const install = (): void => void promptInstall();

interface Step {
  text: string;
  icon?: string; // an ionicon, shown instead of the step number
  glyph?: 'addhome' | 'ring'; // an inline SVG glyph (no ionicon for these)
}

const steps = computed<Step[]>(() => {
  switch (platform.value) {
    case 'ios':
      return [
        { text: 'Tap the Share button in the toolbar.', icon: shareOutline },
        { text: "Scroll and choose 'Add to Home Screen'.", glyph: 'addhome' },
        { text: 'Open Ring from your Home Screen.', glyph: 'ring' },
      ];
    case 'android':
      return [
        { text: 'Open the browser menu (⋮).' },
        { text: "Choose 'Install app' (or 'Add to Home screen').", glyph: 'addhome' },
        { text: 'Open Ring from your Home Screen.', glyph: 'ring' },
      ];
    default:
      return [
        { text: 'Click the install icon in the address bar, or open the browser menu.', icon: downloadOutline },
        { text: "Choose 'Install Ring'." },
        { text: 'Launch Ring from the installed app.', glyph: 'ring' },
      ];
  }
});
</script>

<style scoped>
/* Overlay the always-mounted router outlet AND the key gate (z-index 20), so an
   un-installed browser tab is fully blocked. The content is opaque (theme
   background), so nothing behind it bleeds through. */
ion-page {
  z-index: 30;
}
/* Center the guide in a column wide enough that the subtitle and the longest
   "How to install" line each sit on one line on desktop, instead of stretching
   edge-to-edge. Full width on phones (where it wraps naturally). */
.install-wrap {
  max-width: 760px;
  margin: 0 auto;
  padding-top: max(env(safe-area-inset-top, 0px), 8px);
}
/* Callout for browsers that can't do a real install (old Android Chrome/WebView). */
.cant-install {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--ion-color-warning) 16%, transparent);
  color: var(--ion-color-warning-shade, #b88600);
  font-size: 14px;
  line-height: 1.4;
}
.cant-install ion-icon {
  flex: none;
  font-size: 20px;
  margin-top: 1px;
}
/* Calm, secondary help note (Play Protect "older Android" guidance). Deliberately muted —
   NOT the warning colour of .cant-install — so it reassures rather than alarms. */
.install-help {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--ion-color-medium) 12%, transparent);
  color: var(--ion-color-medium-shade, #6b6f76);
  font-size: 13px;
  line-height: 1.45;
}
.install-help ion-icon {
  flex: none;
  font-size: 18px;
  margin-top: 1px;
}
/* One identical 24×24 start-slot wrapper per step. Putting a uniform element in
   the slot (instead of an icon vs note vs svg) is what makes every row's label
   line up, and we set the gap to the label ourselves with !important to
   override Ionic's per-element-type slotted margins (icons get a big gap, notes
   get none). */
.step-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  min-width: 24px;
  margin-inline-end: 20px !important;
}
/* The icon / svg glyph fills the 24×24 marker. */
.step-glyph {
  width: 24px;
  height: 24px;
}
/* Numbered step badge, same 24×24 footprint as the icons. Reset ion-note's
   default padding/margin/font so the digit sits centered in the circle. */
.step-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  min-width: 24px;
  padding: 0;
  margin: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--ion-color-primary) 16%, transparent);
  color: var(--ion-color-primary);
  font-weight: 600;
  font-size: 13px;
  line-height: 1;
}
</style>
