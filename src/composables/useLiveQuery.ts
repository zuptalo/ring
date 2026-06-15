/**
 * Reactive on-device query. Runs `querier`, re-runs whenever any of the given
 * stores change (via the idb change bus) or when a reactive dependency changes
 * (e.g. a search term). This is what keeps the UI in sync with IndexedDB,
 * including future writes from the sync layer.
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue';
import { subscribe, type StoreName } from '@/db/idb';

/** A live-query ref carries a `loaded` flag that flips true after the first
 *  query resolves, so views can tell "still loading" apart from "genuinely empty"
 *  and avoid flashing an empty state on the initial synchronous tick. */
export type LiveRef<T> = Ref<T> & { loaded: Ref<boolean> };

export function useLiveQuery<T>(
  querier: () => Promise<T>,
  stores: StoreName[],
  initial: T,
  deps: () => unknown = () => undefined,
  // Optional warm source: when it returns a defined value, that value seeds the
  // FIRST paint (and `loaded` starts true) instead of the cold `initial`, so a
  // page backed by a pre-warmed singleton renders populated immediately. When it
  // returns undefined (or is omitted) behavior is identical to before. The live
  // `run()` below still executes and reconciles, so the value stays fresh.
  warmSource?: () => T | undefined,
): LiveRef<T> {
  const warm = warmSource?.();
  const value = ref(warm !== undefined ? warm : initial) as Ref<T>;
  const loaded = ref(warm !== undefined);
  let token = 0;

  const run = async () => {
    const mine = ++token;
    const result = await querier();
    if (mine === token) {
      value.value = result; // ignore stale results
      loaded.value = true;
    }
  };

  run();
  const unsub = subscribe(stores, run);
  watch(deps, run);
  onScopeDispose(unsub);

  // Expose `loaded` as a non-enumerable property on the ref so existing callers
  // that use it as a plain Ref<T> are unaffected (no reactivity-traversal change).
  Object.defineProperty(value, 'loaded', { value: loaded, enumerable: false });
  return value as LiveRef<T>;
}
