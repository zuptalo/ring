<template>
  <div class="pinpad">
    <div class="pad-top ion-text-center">
      <p class="pad-title">{{ title }}</p>
      <!-- Always rendered (with a reserved min-height) when the flow uses a
           description, so the dots don't jump between e.g. "Choose" (has text)
           and "Confirm" (empty). -->
      <p v-if="description || reserveDescription" class="pad-desc">{{ description }}</p>
      <div class="pad-dots">
        <ion-icon
          v-for="i in dotCount"
          :key="i"
          :icon="i <= code.length ? ellipse : ellipseOutline"
          :color="i <= code.length ? 'primary' : 'medium'"
        />
      </div>
      <!-- Always rendered so the keypad doesn't shift when an error toggles. -->
      <p class="pad-error">{{ error }}</p>
    </div>

    <!-- Native buttons (not ion-button) driven on pointerdown: rapid taps register
         immediately and never get debounced/swallowed by a ripple/click delay. -->
    <div class="pad">
      <template v-for="cell in keys" :key="cell.k">
        <!-- digit -->
        <button
          v-if="cell.t === 'd'"
          type="button"
          class="key key-circle"
          :disabled="busy"
          @pointerdown.prevent="press(cell.n!)"
        >
          <span class="key-inner">
            <span class="key-num">{{ cell.n }}</span>
            <!-- Reserve the letter row for every digit except 0 so the numbers
                 line up across a row even when a key has no letters (e.g. 1). -->
            <span v-if="cell.n !== '0'" class="key-sub">{{ cell.s || ' ' }}</span>
          </span>
        </button>

        <!-- backspace -->
        <button
          v-else-if="cell.t === 'back'"
          type="button"
          class="key key-flat"
          :disabled="busy || !code.length"
          @pointerdown.prevent="backspace"
        >
          <ion-icon :icon="backspaceOutline" />
        </button>

        <!-- confirm, only in manual mode (no fixed length). With a fixed length
             the pad auto-submits, so this cell is an invisible spacer that keeps
             the 0 key centered in the bottom row. -->
        <button
          v-else-if="!autoSubmit"
          type="button"
          class="key key-flat"
          :disabled="busy || code.length < minLen"
          @pointerdown.prevent="submit"
        >
          <ion-icon :icon="checkmarkOutline" />
        </button>
        <span v-else class="key key-spacer" aria-hidden="true" />
      </template>
    </div>

    <div class="pad-foot ion-text-center">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { IonIcon } from '@ionic/vue';
import { ellipse, ellipseOutline, backspaceOutline, checkmarkOutline } from 'ionicons/icons';

const props = withDefaults(
  defineProps<{
    title: string;
    description?: string;
    /** Keep the description's vertical space even when it's empty (so the dots
     *  stay put across steps of the same flow). */
    reserveDescription?: boolean;
    /** Exact PIN length (e.g. 4 or 6). When set, the pad auto-submits the moment
     *  that many digits are entered and the confirm button is hidden. */
    length?: number;
    /** Manual-mode bounds (used only when `length` is not given). */
    minLength?: number;
    maxLength?: number;
    busy?: boolean;
    error?: string;
  }>(),
  { description: '', reserveDescription: false, minLength: 4, maxLength: 32, busy: false, error: '' },
);
const emit = defineEmits<{ (e: 'submit', code: string): void }>();

const code = ref('');

const autoSubmit = computed(() => typeof props.length === 'number' && props.length > 0);
const minLen = computed(() => props.length ?? props.minLength);
const maxLen = computed(() => props.length ?? props.maxLength);
const dotCount = computed(
  () => props.length ?? Math.min(props.maxLength, Math.max(props.minLength, code.value.length)),
);

interface Cell {
  k: string;
  t: 'd' | 'back' | 'ok';
  n?: string;
  s?: string;
}
const keys: Cell[] = [
  { k: '1', t: 'd', n: '1' },
  { k: '2', t: 'd', n: '2', s: 'ABC' },
  { k: '3', t: 'd', n: '3', s: 'DEF' },
  { k: '4', t: 'd', n: '4', s: 'GHI' },
  { k: '5', t: 'd', n: '5', s: 'JKL' },
  { k: '6', t: 'd', n: '6', s: 'MNO' },
  { k: '7', t: 'd', n: '7', s: 'PQRS' },
  { k: '8', t: 'd', n: '8', s: 'TUV' },
  { k: '9', t: 'd', n: '9', s: 'WXYZ' },
  { k: 'back', t: 'back' },
  { k: '0', t: 'd', n: '0' },
  { k: 'ok', t: 'ok' },
];

// The tap that completes a PIN runs on `pointerdown`; the browser still synthesizes a
// `click` ~300ms later. If this submit closes the pad's overlay (the unlock gate or a
// PasscodeModal), that click lands on whatever is now under the finger — e.g. a chat
// row — and "ghost-taps" it. Arm a one-shot capture-phase swallow on `window` (not the
// component, so it survives the pad unmounting) to eat exactly that next click.
function armClickSwallow(): void {
  let timer = 0;
  const swallow = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    window.clearTimeout(timer);
    window.removeEventListener('click', swallow, true);
  };
  window.addEventListener('click', swallow, true);
  timer = window.setTimeout(() => window.removeEventListener('click', swallow, true), 800);
}
function fireSubmit(): void {
  armClickSwallow();
  emit('submit', code.value);
}

function press(d: string): void {
  if (props.busy || code.value.length >= maxLen.value) return;
  code.value += d;
  // Auto-verify the instant the fixed length is reached (no confirm tap).
  if (autoSubmit.value && code.value.length === props.length) fireSubmit();
}
function backspace(): void {
  if (!props.busy) code.value = code.value.slice(0, -1);
}
function submit(): void {
  if (!props.busy && code.value.length >= minLen.value) fireSubmit();
}

// Hardware keyboard (desktop / external keyboards): digits append, Backspace
// deletes, Enter submits in manual mode, so quick typing works too, not just taps.
function onKey(e: KeyboardEvent): void {
  if (props.busy) return;
  // Never hijack keystrokes meant for a focused text field, or for an overlay opened
  // ON TOP of the pad, notably the hex "Recovery code" alert over the unlock gate.
  // Swallowing its digits/Backspace would make a forgotten-passcode recovery (and
  // thus the keystore) unrecoverable. (ion-modal is intentionally NOT listed: the
  // PasscodeModal's own pad must keep receiving keys.)
  const t = e.target as HTMLElement | null;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (document.querySelector('ion-alert, ion-action-sheet, ion-popover')) return;
  if (/^[0-9]$/.test(e.key)) {
    e.preventDefault();
    press(e.key);
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    backspace();
  } else if (e.key === 'Enter' && !autoSubmit.value) {
    e.preventDefault();
    submit();
  }
}
onMounted(() => window.addEventListener('keydown', onKey));
onUnmounted(() => window.removeEventListener('keydown', onKey));
</script>

<style scoped>
/* Full-height column: title/dots near the top, keypad anchored toward the
   bottom (margin-top:auto), optional foot (e.g. "Forgot passcode?") below. */
.pinpad {
  display: flex;
  flex-direction: column;
  min-height: 100%;
  box-sizing: border-box;
  padding: 0 16px 36px; /* extra bottom space lifts the keypad up slightly */
}
.pad-top {
  /* Content is fullscreen (so the translucent header blurs behind it); clear
     the header + status-bar safe area, then sit the title a bit below it. */
  padding-top: calc(env(safe-area-inset-top, 0px) + 52px);
  margin-bottom: 20px;
}
.pad-title {
  font-size: 26px;
  margin: 0 0 4px;
}
.pad-desc {
  font-size: 14px;
  line-height: 1.4;
  color: var(--app-text-muted, #8e8e93);
  margin: 0 auto 8px;
  min-height: 60px;
  max-width: 320px;
}
.pad-dots {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
  min-height: 22px;
  margin: 20px 0 0;
  font-size: 16px;
}
.pad-error {
  color: var(--ion-color-danger);
  font-size: 14px;
  margin: 12px 0 0;
  min-height: 20px;
}
.pad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px 26px;
  justify-items: center;
  align-items: center;
  width: 100%;
  max-width: 330px;
  margin: auto auto 0;
}
/* Native key buttons: reset, then style. touch-action:manipulation kills the
   300ms tap delay; user-select:none avoids text-selection flicker on fast taps. */
.key {
  border: none;
  padding: 0;
  margin: 0;
  background: transparent;
  color: var(--ion-text-color);
  font-family: inherit;
  cursor: pointer;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.key:disabled {
  opacity: 0.4;
  cursor: default;
}
.key-circle {
  width: 82px;
  height: 82px;
  border-radius: 50%;
  background: rgba(120, 120, 128, 0.18);
  transition: background-color 0.08s ease, transform 0.06s ease;
}
.key-circle:not(:disabled):active {
  background: rgba(120, 120, 128, 0.42);
  transform: scale(0.94);
}
.key-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  line-height: 1;
  pointer-events: none; /* taps always hit the button, never the inner spans */
}
.key-num {
  font-size: 33px;
  font-weight: 400;
}
.key-sub {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 2px;
  margin-top: 3px;
}
.key-flat {
  width: 82px;
  height: 82px;
  font-size: 26px;
  color: var(--app-text-muted, #8e8e93);
  border-radius: 50%;
}
.key-flat:not(:disabled):active {
  background: rgba(120, 120, 128, 0.22);
}
.key-flat ion-icon {
  font-size: 26px;
  pointer-events: none;
}
.key-spacer {
  width: 82px;
  height: 82px;
  cursor: default;
}
.pad-foot {
  margin-top: 18px;
  min-height: 24px;
}
</style>
