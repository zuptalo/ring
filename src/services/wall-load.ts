import { ref } from 'vue';

/**
 * True once the FIRST unlocked Wall sync attempt has completed. Drives the Wall's first-load
 * spinner: a fresh device (empty local store) should show a loader while it pulls from the
 * server, not the "No posts yet" empty state. A leaf module so both the data layer (syncPosts
 * sets it) and the composable (useWall reads it) can import it without a cycle.
 */
export const wallSyncedOnce = ref(false);
