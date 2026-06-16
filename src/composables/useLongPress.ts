import { ref } from 'vue';

/**
 * Shared long-press detection (spec 1008). A press that stays put for `duration`ms
 * fires `onLongPress(payload)`; any drag beyond `moveThreshold` (a swipe-to-reply or a
 * scroll) cancels it, as does lifting early. After a long-press fires, `consumeClick()`
 * returns false once so the consumer can swallow the trailing `click` (the tap action
 * must not also run).
 *
 * One instance can serve a whole `v-for` of bubbles: only one press happens at a time,
 * and the payload (e.g. the message) is captured per pointerdown. This generalises the
 * pattern previously inlined in VideoNote so tap-vs-menu behaves identically everywhere.
 */
export interface LongPressOptions {
  duration?: number; // hold time in ms before it fires (default 500)
  moveThreshold?: number; // movement in px that cancels the press (default 10)
}

export function useLongPress<T>(
  onLongPress: (payload: T, ev: PointerEvent) => void,
  opts: LongPressOptions = {},
) {
  const duration = opts.duration ?? 500;
  const moveThreshold = opts.moveThreshold ?? 10;

  let timer: number | undefined;
  let startX = 0;
  let startY = 0;
  // True briefly after a long-press fires, so the trailing click can be suppressed.
  const suppressClick = ref(false);

  function clear(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function onPointerDown(payload: T, ev: PointerEvent): void {
    startX = ev.clientX;
    startY = ev.clientY;
    clear();
    timer = window.setTimeout(() => {
      timer = undefined;
      suppressClick.value = true;
      onLongPress(payload, ev);
    }, duration);
  }

  function onPointerMove(ev: PointerEvent): void {
    if (timer === undefined) return;
    if (Math.abs(ev.clientX - startX) > moveThreshold || Math.abs(ev.clientY - startY) > moveThreshold) {
      clear(); // a drag (swipe-to-reply / scroll) is not a long-press
    }
  }

  function onPointerUp(): void {
    clear();
  }

  /** Call from the consumer's @click: returns false (once) if a long-press just fired,
   *  so the tap action is skipped; true for a genuine tap. */
  function consumeClick(): boolean {
    if (suppressClick.value) {
      suppressClick.value = false;
      return false;
    }
    return true;
  }

  return { onPointerDown, onPointerMove, onPointerUp, consumeClick };
}
