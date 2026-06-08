/**
 * Quick decline replies: short canned messages you can send when declining an
 * incoming call ("In a meeting.", "Can I call you back?"...). Customizable under
 * Settings > Calls. Stored as a plain string[] in the settings store.
 */
import { getSetting, setSetting } from '@/db/queries';

export const QUICK_DECLINES_KEY = 'calls.quickDeclines';

export const DEFAULT_DECLINES = [
  'Can’t talk right now, what’s up?',
  'I’ll call you back.',
  'In a meeting.',
  'On my way.',
];

/** The user's quick decline replies (falls back to the defaults). */
export function getQuickDeclines(): Promise<string[]> {
  return getSetting<string[]>(QUICK_DECLINES_KEY, DEFAULT_DECLINES);
}

/** Persist the quick decline replies (empties trimmed out). */
export function setQuickDeclines(list: string[]): Promise<void> {
  return setSetting(
    QUICK_DECLINES_KEY,
    list.map((s) => s.trim()).filter(Boolean),
  );
}
