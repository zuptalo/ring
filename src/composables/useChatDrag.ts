/**
 * Pointer-event state machine for the pinned-grid drag + long-press peek
 * (spec 1045). One controller per Chats page: the gesture crosses two components
 * (grid tiles and list rows) and must coordinate a single floating proxy, one
 * active gesture, page auto-scroll, and click swallowing — so it lives here, not
 * in either component.
 *
 * Gesture timeline (iMessage parity):
 *   press ──350ms──► LIFT (proxy floats, scroll locked)
 *     · >8px movement BEFORE the lift cancels the hold — scroll/swipe win.
 *     · after the lift, >6px movement enters DRAG (grid gap follows the pointer).
 *     · still holding ~550ms past the lift with no drag → PEEK (read-only
 *       preview overlay; the gesture ends there).
 *   release while dragging → drop: reorder / pin-at-slot / unpin / cancel.
 *
 * All geometry/list math is pure (src/utils/drag-math.ts) and unit-tested; this
 * file owns only timers, listeners, and reactive state.
 */
import { reactive, computed } from 'vue';
import { gridSlotAt, previewOrder, edgeScrollVelocity } from '@/utils/drag-math';
import type { Chat } from '@/db/types';

const LIFT_MS = 350; // press-and-hold until the avatar lifts
const PEEK_MS = 550; // further still-hold until the peek opens (≈900ms total)
const PRE_LIFT_CANCEL_PX = 8; // movement before the lift = the user is scrolling/swiping
const DRAG_START_PX = 6; // movement after the lift that commits to dragging
const GRID_SLACK_PX = 24; // forgiveness around the grid rect while targeting

export type DragPhase = 'idle' | 'held' | 'lifted' | 'dragging';
export type DragOrigin = 'grid' | 'list';

export interface DragState {
  phase: DragPhase;
  origin: DragOrigin;
  chat: Chat | null;
  /** Pointer position (viewport coords). */
  x: number;
  y: number;
  /** Where the pressed element was at lift time (proxy start box). */
  startRect: { left: number; top: number; width: number; height: number };
  startX: number;
  startY: number;
  /** Grid slot the drag currently targets (null = not over the grid). */
  hoverIndex: number | null;
  /** Over the grid but the 9-pin cap blocks pinning (list-origin only) → ⊘ badge. */
  blocked: boolean;
}

export interface ChatDragOptions {
  /** The .pin-grid element (null when no pins / other filter). */
  gridEl: () => HTMLElement | null;
  /** The ion-content scroll element, for near-edge auto-scroll. */
  scrollEl: () => HTMLElement | null;
  /** Rank-ordered pinned chat ids (the grid's true order). */
  pinnedIds: () => string[];
  /** The pin cap (MAX_PINNED_CHATS), injected to keep this module UI-only. */
  maxPins: number;
  /** Grid-origin drop inside the grid: the full new arrangement. */
  onReorder: (orderedIds: string[]) => void;
  /** Grid-origin drop outside the grid: unpin. */
  onUnpin: (chatId: string) => void;
  /** List-origin drop over the grid below the cap: pin at that slot. */
  onPin: (chatId: string, atIndex: number) => void;
  /** Still-hold past the lift: open the peek overlay. */
  onPeek: (chat: Chat) => void;
}

export function useChatDrag(opts: ChatDragOptions) {
  const state = reactive<DragState>({
    phase: 'idle',
    origin: 'grid',
    chat: null,
    x: 0,
    y: 0,
    startRect: { left: 0, top: 0, width: 0, height: 0 },
    startX: 0,
    startY: 0,
    hoverIndex: null,
    blocked: false,
  });

  let liftTimer: ReturnType<typeof setTimeout> | null = null;
  let peekTimer: ReturnType<typeof setTimeout> | null = null;
  let pointerId = -1;
  let captureEl: HTMLElement | null = null;
  let scrollRaf = 0;
  // A completed lift/peek/drag must NOT let the trailing click open the chat
  // underneath; consumed by the page's open() handler.
  let swallowNextClick = false;
  // Belt and braces for the same problem: the release-click's TARGET is
  // unpredictable (pointer capture may retarget it to the pressed tile; a peek
  // means it lands on the just-opened overlay — which must not instantly
  // dismiss). A one-shot document-capture listener eats it wherever it lands.
  // The browser doesn't always FIRE that release-click (down/up targets may
  // diverge), so the trap also disarms on the next pointerDOWN — a new press
  // means the release-click came and went (or never will), and the new tap's
  // own click must pass.
  const clickTrap = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    disarmClickTrap();
  };
  const trapDisarmOnDown = (): void => disarmClickTrap();
  function armClickTrap(): void {
    document.addEventListener('click', clickTrap, true);
    document.addEventListener('pointerdown', trapDisarmOnDown, true);
  }
  function disarmClickTrap(): void {
    document.removeEventListener('click', clickTrap, true);
    document.removeEventListener('pointerdown', trapDisarmOnDown, true);
  }

  /** The grid's display order mid-drag (drives the live gap). */
  const displayIds = computed(() => {
    if ((state.phase !== 'dragging' && state.phase !== 'lifted') || !state.chat) {
      return opts.pinnedIds();
    }
    return previewOrder(opts.pinnedIds(), state.chat.id, state.hoverIndex);
  });

  function clearTimers(): void {
    if (liftTimer) clearTimeout(liftTimer);
    if (peekTimer) clearTimeout(peekTimer);
    liftTimer = peekTimer = null;
  }

  // While lifted/dragging the page must not scroll under the finger. The
  // listener is registered AT LIFT TIME — safe, because the finger has been
  // still for LIFT_MS, so no scroll gesture is in flight to conflict with.
  const blockTouchMove = (e: TouchEvent): void => e.preventDefault();
  // Android synthesizes a contextmenu on long-press; while a gesture is live it
  // must not pop the actions sheet (or the OS menu) over the lift/peek.
  const blockContextMenu = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  function lockPage(): void {
    document.addEventListener('touchmove', blockTouchMove, { passive: false });
    document.addEventListener('contextmenu', blockContextMenu, true);
    // iOS can have started a text selection during the hold (rows are full of
    // text); an active selection eats the next tap, so kill it and keep
    // selection off for the rest of the gesture.
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      /* selection API quirks are non-fatal */
    }
    document.documentElement.style.setProperty('-webkit-user-select', 'none');
    document.documentElement.style.setProperty('user-select', 'none');
  }
  function unlockPage(): void {
    document.removeEventListener('touchmove', blockTouchMove);
    document.removeEventListener('contextmenu', blockContextMenu, true);
    document.documentElement.style.removeProperty('-webkit-user-select');
    document.documentElement.style.removeProperty('user-select');
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      /* ditto */
    }
  }

  function cleanup(): void {
    clearTimers();
    stopAutoScroll();
    unlockPage();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    if (captureEl && pointerId !== -1) {
      try {
        captureEl.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
    }
    captureEl = null;
    pointerId = -1;
    state.phase = 'idle';
    state.chat = null;
    state.hoverIndex = null;
    state.blocked = false;
  }

  /** Entry point: components call this from a tile's/row's pointerdown. */
  function pressStart(e: PointerEvent, chat: Chat, origin: DragOrigin): void {
    // Primary button/touch only; a second finger while a gesture is live is noise.
    if (state.phase !== 'idle' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = e.currentTarget as HTMLElement;
    state.phase = 'held';
    state.origin = origin;
    state.chat = chat;
    state.x = state.startX = e.clientX;
    state.y = state.startY = e.clientY;
    const r = el.getBoundingClientRect();
    state.startRect = { left: r.left, top: r.top, width: r.width, height: r.height };
    pointerId = e.pointerId;
    captureEl = el;
    swallowNextClick = false;
    disarmClickTrap(); // a stale trap from an interrupted gesture must not eat this tap

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    liftTimer = setTimeout(lift, LIFT_MS);
  }

  function lift(): void {
    if (state.phase !== 'held') return;
    state.phase = 'lifted';
    swallowNextClick = true;
    armClickTrap();
    try {
      captureEl?.setPointerCapture(pointerId);
    } catch {
      /* pointer already gone (e.g. torn-down node) — the up/cancel handlers cope */
    }
    lockPage();
    try {
      navigator.vibrate?.(10);
    } catch {
      /* haptics are best-effort */
    }
    peekTimer = setTimeout(() => {
      // Still holding, never dragged → the peek. The gesture ends here; the
      // armed trap eats the release-click (if the browser fires one) so it
      // can't instantly dismiss the fresh overlay.
      const chat = state.chat;
      cleanup();
      if (chat) opts.onPeek(chat);
    }, PEEK_MS);
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    state.x = e.clientX;
    state.y = e.clientY;
    const dist = Math.hypot(e.clientX - state.startX, e.clientY - state.startY);

    if (state.phase === 'held') {
      // Movement before the lift = a scroll or a row swipe; get out of the way.
      if (dist > PRE_LIFT_CANCEL_PX) cleanup();
      return;
    }
    if (state.phase === 'lifted' && dist > DRAG_START_PX) {
      state.phase = 'dragging';
      if (peekTimer) clearTimeout(peekTimer);
      peekTimer = null;
      startAutoScroll();
    }
    if (state.phase === 'dragging') updateHover();
  }

  function updateHover(): void {
    const grid = opts.gridEl();
    if (!grid || !state.chat) {
      state.hoverIndex = null;
      state.blocked = false;
      return;
    }
    const rect = grid.getBoundingClientRect();
    const pins = opts.pinnedIds().length;
    // A member drag rearranges `pins` slots; a foreign (list) drag previews an
    // insertion, so the trailing slot is a target too.
    const count = state.origin === 'grid' ? pins : pins + 1;
    const slot = gridSlotAt(state.x, state.y, rect, count, 3, GRID_SLACK_PX);
    if (state.origin === 'list' && slot != null && pins >= opts.maxPins) {
      // Over the grid but full: show the ⊘ badge, keep the gap closed.
      state.blocked = true;
      state.hoverIndex = null;
      return;
    }
    state.blocked = false;
    state.hoverIndex = slot;
  }

  // Near-edge auto-scroll: dragging a far-down row toward the grid needs the page
  // to follow. Runs on rAF while dragging; hover is re-derived after each nudge
  // because scrolling moves the grid under the (stationary) pointer.
  function startAutoScroll(): void {
    if (scrollRaf) return;
    const step = (): void => {
      scrollRaf = 0;
      if (state.phase !== 'dragging') return;
      const el = opts.scrollEl();
      if (el) {
        const r = el.getBoundingClientRect();
        const v = edgeScrollVelocity(state.y, r.top, r.height);
        if (v !== 0) {
          el.scrollTop += v;
          updateHover();
        }
      }
      scrollRaf = requestAnimationFrame(step);
    };
    scrollRaf = requestAnimationFrame(step);
  }
  function stopAutoScroll(): void {
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    scrollRaf = 0;
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    const { phase, origin, chat, hoverIndex, blocked } = state;
    if (phase === 'dragging' && chat) {
      if (origin === 'grid') {
        if (hoverIndex == null) {
          opts.onUnpin(chat.id); // dropped over the list (or anywhere off-grid)
        } else {
          const next = previewOrder(opts.pinnedIds(), chat.id, hoverIndex);
          const prev = opts.pinnedIds();
          if (next.some((id, i) => id !== prev[i])) opts.onReorder(next);
        }
      } else if (hoverIndex != null && !blocked) {
        opts.onPin(chat.id, hoverIndex);
      }
      // else: list-origin drop off-grid (or blocked) → nothing, it floats home.
    }
    // 'held' = a plain tap: cleanup without swallowing, the click opens the chat.
    cleanup();
  }

  function onPointerCancel(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    cleanup();
  }

  /** True once after a lift/drag/peek — the page's open() consults this so the
   *  trailing click can't ALSO open the chat under the gesture. */
  function consumeClickSwallow(): boolean {
    const s = swallowNextClick;
    swallowNextClick = false;
    return s;
  }

  return { state, displayIds, pressStart, consumeClickSwallow };
}
