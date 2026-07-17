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
    const dark = pref === 'dark' || (pref === 'system' && mql.matches);
    document.documentElement.classList.toggle('ion-palette-dark', dark);
  };

  // Re-apply when the stored choice changes (settings live query updates) and
  // when the OS theme flips while on 'system'.
  watch(rows, apply, { immediate: true });
  mql.addEventListener('change', apply);
}
