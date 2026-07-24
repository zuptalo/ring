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

// (follow-system flash fix) The RESOLVED dark/light decision, mirrored as '1'/'0'.
// The pref mirror above isn't enough for 'system': the pre-paint has to re-derive
// dark from matchMedia('(prefers-color-scheme: dark)'), and on an iOS PWA cold
// relaunch that query briefly reports LIGHT before the OS scheme settles — so a
// system-mode user saw a bright frame flash before useTheme corrected it (explicit
// light/dark never flashed because they don't consult matchMedia). Storing the LAST
// resolved value lets the pre-paint paint the correct palette with zero matchMedia
// dependency; if the OS theme changed while the app was closed, the first frame is
// one-frame stale and useTheme fixes it — far rarer than the every-launch flash.
export const THEME_RESOLVED_KEY = 'appearance.theme.dark';

// (spec 2049) Ring defaults to the dark palette when the user has never chosen a
// theme. 'system' remains an explicit choice for anyone who wants OS-following;
// it is just no longer the default. Kept in sync with the pre-paint fallback in
// index.html (`|| 'dark'`) and the schema default for `appearance.theme`.
export const DEFAULT_PREF: ThemePref = 'dark';

export function useTheme(): void {
  const rows = useLiveQuery(
    () => getAll<Setting>('settings'),
    ['settings'],
    [] as Setting[],
  );
  const mql = window.matchMedia('(prefers-color-scheme: dark)');

  const apply = () => {
    // (spec 2049) Until the settings live query resolves, `rows.value` is still
    // the empty initial array. Guessing a theme from it would compute DEFAULT_PREF
    // and TOGGLE OFF the `ion-palette-dark` class the index.html pre-paint script
    // already set correctly — flashing the wrong palette for a frame on every cold
    // launch. This is the flash two earlier fixes missed: it only hit users whose
    // explicit choice differs from their OS scheme (a 'system' user's guess happens
    // to match, so they never saw it). The pre-paint owns the first frame; wait for
    // the real preference (rows.loaded) before ever touching the class.
    if (!rows.loaded.value) return;
    const pref =
      (rows.value.find((r) => r.key === 'appearance.theme')?.value as ThemePref) ??
      DEFAULT_PREF;
    const dark = resolveDark(pref, mql.matches);
    document.documentElement.classList.toggle('ion-palette-dark', dark);
    // Keep the synchronous mirrors current so the NEXT cold start paints correctly:
    // the pref (for reference) and the already-resolved dark decision (the one the
    // pre-paint actually trusts, so it never re-consults the flaky cold-start
    // matchMedia for 'system').
    try {
      localStorage.setItem(THEME_MIRROR_KEY, pref);
      localStorage.setItem(THEME_RESOLVED_KEY, dark ? '1' : '0');
    } catch {
      /* storage blocked → pre-paint falls back to the dark default (spec 2049) */
    }
  };

  // Re-apply when the stored choice changes (settings live query updates) and
  // when the OS theme flips while on 'system'.
  watch(rows, apply, { immediate: true });
  mql.addEventListener('change', apply);
}
