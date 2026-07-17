/**
 * `v-enter-send` — on a physical keyboard (a device whose primary pointer is fine, i.e.
 * a mouse/trackpad), plain Enter triggers the bound send callback and Shift+Enter
 * inserts a newline; on touch the Return key keeps inserting line breaks. IME
 * composition never sends. Bound on the NATIVE input/textarea (via getInputElement) —
 * a keydown on the ion-* host doesn't fire reliably across the shadow boundary — so it
 * works on both ion-input and ion-textarea, and in v-for lists.
 *
 * Usage: <ion-textarea v-enter-send="() => send(item)" />
 */
import type { Directive, DirectiveBinding } from 'vue';

const desktopKeyboard =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: fine)')
    : null;

interface ElState {
  native?: HTMLElement;
  handler: (e: KeyboardEvent) => void;
  cb: () => void;
}

type IonHost = HTMLElement & {
  getInputElement?: () => Promise<HTMLElement>;
  __enterSend?: ElState;
};

export const vEnterSend: Directive<IonHost, () => void> = {
  mounted(el, binding: DirectiveBinding<() => void>) {
    const state: ElState = {
      cb: binding.value,
      handler: (e: KeyboardEvent) => {
        if (e.key !== 'Enter') return;
        if (desktopKeyboard?.matches && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault(); // swallow the newline the field would otherwise insert
          state.cb?.();
        }
      },
    };
    el.__enterSend = state;
    void el
      .getInputElement?.()
      .then((native) => {
        state.native = native;
        native.addEventListener('keydown', state.handler);
      })
      .catch(() => {});
  },
  updated(el, binding: DirectiveBinding<() => void>) {
    if (el.__enterSend) el.__enterSend.cb = binding.value;
  },
  unmounted(el) {
    const s = el.__enterSend;
    if (s?.native) s.native.removeEventListener('keydown', s.handler);
    delete el.__enterSend;
  },
};
