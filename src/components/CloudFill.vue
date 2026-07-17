<template>
  <!-- Upload progress as a cloud silhouette filling bottom-up: the outline is the empty
       state, the filled glyph on top is clipped to the progressed fraction. It lives IN
       the media visual (thumbnail centre, chip icon slot, cover corner) rather than in a
       bar row of its own, so nothing reflows when the upload finishes and the indicator
       unmounts — the bubble keeps its exact size throughout (the arrival pop stays put). -->
  <span
    class="cloud-fill"
    role="progressbar"
    aria-label="Uploading"
    :aria-valuenow="Math.round(progress * 100)"
    aria-valuemin="0"
    aria-valuemax="100"
  >
    <ion-icon class="cf-outline" :icon="cloudOutline" aria-hidden="true" />
    <ion-icon class="cf-fill" :icon="cloud" aria-hidden="true" :style="{ clipPath: clip }" />
    <!-- Indeterminate orbit around the cloud: slow encodes/uploads can sit at the same
         waterline for a while, and a static cloud reads as stuck — the spinning arc says
         "still working" independent of the fill level. -->
    <svg class="cf-ring" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="18.5" pathLength="100" />
    </svg>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { IonIcon } from '@ionic/vue';
import { cloud, cloudOutline } from 'ionicons/icons';

const props = defineProps<{ progress: number }>(); // 0..1

// The waterline is relative to the CLOUD SHAPE, not the icon's square box: the ionicons
// cloud path spans y 80..432 of the 512 viewBox (top 15.6%, height 68.8%). Clipping by raw
// box percentage would show a 35% upload as a near-full cloud (most of the glyph's ink sits
// in the lower half of the box); mapping into the glyph band makes the fill read true.
const GLYPH_TOP = 80 / 512;
const GLYPH_H = (432 - 80) / 512;
const clip = computed(() => {
  const p = Math.max(0, Math.min(1, props.progress));
  return `inset(${(GLYPH_TOP + (1 - p) * GLYPH_H) * 100}% 0 0 0)`;
});
</script>

<style scoped>
/* Sized by the host's font-size: both glyphs stack in the same 1em box (the filled and
   outlined ionicons clouds share their geometry, so the fill registers exactly). */
.cloud-fill {
  position: relative;
  display: inline-flex;
  width: 1em;
  height: 1em;
  flex: none;
}
.cloud-fill ion-icon {
  position: absolute;
  inset: 0;
  font-size: 1em;
}
/* The empty state stays a faint silhouette so the bright fill rising through it reads as
   a waterline even at chip sizes — same-color outline+fill just looks like a full cloud. */
.cf-outline {
  opacity: 0.45;
}
/* Progress arrives in bursts from the uploader; a short linear glide between values keeps
   the waterline rising smoothly instead of stepping. */
.cf-fill {
  transition: clip-path 200ms linear;
}
/* The orbit circumscribes the cloud at 1.5em — with the standard 28px cloud that's a 42px
   ring, the diameter the play button's circle used to occupy. Kept spinning even under
   reduced motion: it's the "still working" status itself, not decoration. */
.cf-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 1.5em;
  height: 1.5em;
  margin: -0.75em 0 0 -0.75em;
  overflow: visible;
  animation: cf-spin 1.1s linear infinite;
}
.cf-ring circle {
  fill: none;
  stroke: currentColor;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: 30 70; /* a ~30% arc orbiting the cloud */
  opacity: 0.9;
}
@keyframes cf-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
