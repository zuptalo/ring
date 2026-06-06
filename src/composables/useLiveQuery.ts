/**
 * Reactive on-device query. Runs `querier`, re-runs whenever any of the given
 * stores change (via the idb change bus) or when a reactive dependency changes
 * (e.g. a search term). This is what keeps the UI in sync with IndexedDB,
 * including future writes from the sync layer.
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue';
import { subscribe, type StoreName } from '@/db/idb';

export function useLiveQuery<T>(
  querier: () => Promise<T>,
  stores: StoreName[],
  initial: T,
  deps: () => unknown = () => undefined,
): Ref<T> {
  const value = ref(initial) as Ref<T>;
  let token = 0;

  const run = async () => {
    const mine = ++token;
    const result = await querier();
    if (mine === token) value.value = result; // ignore stale results
  };

  run();
  const unsub = subscribe(stores, run);
  watch(deps, run);
  onScopeDispose(unsub);

  return value;
}
