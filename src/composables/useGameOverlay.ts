// The fullscreen game overlay's state machine (spec 1038 FR-006/FR-007).
//
// Module-scoped refs, MinimizedCall-style: GameOverlay.vue renders `active`
// whenever `open` is true; `active && !open` means MINIMIZED (the floating
// pill is derived separately from stored sessions — it does not read this).
// Deliberately memory-only: after a reload the pill/card re-enter the game;
// the session itself lives in IndexedDB.
//
// Fullscreen is requested on the APP ROOT (documentElement), not the overlay
// element — the whole DOM stays inside the fullscreen top layer, so the
// notification banner stack (z 19000) keeps rendering above the overlay
// (z 16000) untouched. Both fullscreen calls are promise-guarded: a blocked
// request (iframe policy, iPhone Safari's missing element-fullscreen) must be
// harmless — the fixed-position overlay IS the experience then (handoff
// §Fullscreen). An OS-initiated fullscreen exit (Esc, system gesture) is
// cosmetic and never closes the overlay.

import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { setActiveGame } from '@/services/game-active'

export type ActiveGame =
  | { surface: 'chat'; chatId: string; messageId: string; gameType: string }
  | { surface: 'wall'; postId: string; gameType: string }

/** The session's carrying id — keys staged commits, fleet-secret lookups by
 *  session, and the notify suppression. */
export const gameSessionKey = (g: ActiveGame): string => (g.surface === 'chat' ? g.messageId : g.postId)

export const overlayGame = ref<ActiveGame | null>(null)
export const overlayOpen = ref(false)

// True while WE own a pushed history entry (so back = minimize, never a
// stranded navigation). Cleared when the entry is consumed — by our own
// history.back() or by the user's back gesture.
let historyArmed = false

function enterFullscreen(): void {
  try {
    const p = document.documentElement.requestFullscreen?.()
    // A rejected promise is the documented "blocked" signal; a sync try/catch
    // alone would NOT catch it (handoff §Fullscreen).
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch {
    /* no element fullscreen on this platform — the overlay covers the app */
  }
}
function exitFullscreen(): void {
  try {
    if (document.fullscreenElement) {
      const p = document.exitFullscreen?.()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
  } catch {
    /* ignore */
  }
}

export function openGame(target: ActiveGame): void {
  overlayGame.value = target
  overlayOpen.value = true
  setActiveGame(gameSessionKey(target))
  enterFullscreen()
  if (!historyArmed) {
    try {
      history.pushState({ ringGame: true }, '')
      historyArmed = true
    } catch {
      /* history API hiccup — back will just navigate; the route watcher minimizes */
    }
  }
}

/** Leave the game view but keep the session "current" (banner taps, back).
 *  The floating pill (derived from stored state) is the way back in. */
export function minimizeGame(): void {
  if (!overlayOpen.value) return
  overlayOpen.value = false
  overlayGame.value = null
  setActiveGame(null)
  exitFullscreen()
  disarmHistory()
}

/** Exit deliberately (chevron / Leave): back on the untouched launch surface. */
export function closeGame(): void {
  minimizeGame()
}

function disarmHistory(): void {
  if (!historyArmed) return
  historyArmed = false
  try {
    history.back() // consume our pushed entry; popstate sees open=false and ignores
  } catch {
    /* ignore */
  }
}

let wired = false
/** One-time global wiring, called from App.vue's setup. */
export function useGameOverlay(): void {
  if (wired) return
  wired = true

  // Hardware/gesture back while the game is open → minimize, not navigation.
  window.addEventListener('popstate', () => {
    if (overlayOpen.value) {
      historyArmed = false // the user's back consumed our entry
      overlayOpen.value = false
      overlayGame.value = null
      setActiveGame(null)
      exitFullscreen()
    }
  })

  // OS-initiated fullscreen exit is cosmetic — the overlay stays open. (No
  // handler needed for that; this exists only to re-assert nothing.)
  document.addEventListener('fullscreenchange', () => {
    /* deliberate no-op: overlayOpen is the truth, not fullscreenElement */
  })

  // Any navigation while open (banner tap → router.push, deep links, tab
  // switches) minimizes the game — the toast-tap flow of FR-007 falls out of
  // this single watcher.
  const router = useRouter()
  watch(
    () => router.currentRoute.value.fullPath,
    () => {
      if (overlayOpen.value) minimizeGame()
    },
  )
}
