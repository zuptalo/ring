/**
 * Applies the persisted Appearance → Theme choice ('system' | 'light' | 'dark')
 * by toggling Ionic's `ion-palette-dark` class on <html>. Pairs with the
 * `dark.class.css` palette imported in main.ts. Reacts to settings writes (the
 * Theme radio) and, for 'system', to the OS color-scheme changing.
 *
 * Stock-Ionic theming only: class toggle + CSS variables, no custom component
 * styles.
 */
import { watch } from 'vue';
import { getAll } from '@/db/idb';
import { useLiveQuery } from '@/composables/useLiveQuery';
import type { Setting } from '@/db/types';

type ThemePref = 'system' | 'light' | 'dark';

// (spec 2045) The one place the dark/light decision is made. Duplicated as a 3-line inline
// resolver in index.html for the pre-paint frame (it can't import this module before the
// bundle loads) — keep the two in sync.
export function resolveDark(pref: ThemePref, prefersDark: boolean): boolean {
  return pref === 'dark' || (pref === 'system' && prefersDark);
}

// (spec 2045) localStorage key mirrored from the IndexedDB `appearance.theme` setting, so
// the index.html pre-paint script can resolve the theme SYNCHRONOUSLY (IDB is async and
// only resolves after Vue mounts — the window that flashed the light palette on a cold
// relaunch). IndexedDB stays the source of truth; this is a read-optimization for one frame.
export const THEME_MIRROR_KEY = 'appearance.theme';

export function useTheme(): void {
  const rows = useLiveQuery(
    () => getAll<Setting>('settings'),
    ['settings'],
    [] as Setting[],
  );
  const mql = window.matchMedia('(prefers-color-scheme: dark)');

  const apply = () => {
    const pref =
      (rows.value.find((r) => r.key === 'appearance.theme')?.value as ThemePref) ??
      'system';
    const dark = resolveDark(pref, mql.matches);
    document.documentElement.classList.toggle('ion-palette-dark', dark);
    // Keep the synchronous mirror current so the NEXT cold start paints correctly.
    try {
      localStorage.setItem(THEME_MIRROR_KEY, pref);
    } catch {
      /* storage blocked → pre-paint falls back to prefers-color-scheme */
    }
  };

  // Re-apply when the stored choice changes (settings live query updates) and
  // when the OS theme flips while on 'system'.
  watch(rows, apply, { immediate: true });
  mql.addEventListener('change', apply);
}
