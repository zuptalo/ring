/**
 * Surfaces "a contact changed their name/photo — adopt it?" prompts.
 *
 * When a peer publishes a NEW name/avatar, `updateContactProfile` (queries.ts) stages it
 * on the contact as `pendingName`/`pendingAvatar` instead of silently overwriting the
 * displayed name. This composable watches for those staged changes and raises a
 * persistent in-app action banner (the same overlay as the update prompt) offering
 * "Use it" (adopt) / "Not now" (dismiss). Dismiss won't re-prompt until the peer changes
 * again — `remoteName`/`remoteAvatar` already track the last-seen value.
 *
 * Mounted once (App.vue). One banner per contact, keyed `profile:<id>` so a second change
 * replaces rather than stacks.
 */
import { watch } from 'vue';
import { personOutline } from 'ionicons/icons';
import { useLiveQuery } from './useLiveQuery';
import { listContacts, adoptContactProfile, dismissContactProfile } from '@/db/queries';
import { showActionBanner } from '@/services/notify';
import type { Contact } from '@/db/types';

export function useContactProfilePrompts(): void {
  const contacts = useLiveQuery(() => listContacts(), ['contacts'], [] as Contact[]);
  // Contacts already shown a banner this session, so a reactive re-run doesn't re-raise it.
  const shown = new Set<string>();

  watch(
    contacts,
    (list) => {
      const pending = list.filter((c) => c.pendingName != null || c.pendingAvatar != null);
      const pendingIds = new Set(pending.map((c) => c.id));
      // Forget contacts that are no longer pending (adopted/dismissed) so a FUTURE
      // change re-raises the banner.
      for (const id of [...shown]) if (!pendingIds.has(id)) shown.delete(id);

      for (const c of pending) {
        if (shown.has(c.id)) continue;
        shown.add(c.id);
        const newName = c.pendingName ?? c.name;
        const nameChanged = c.pendingName != null && c.pendingName !== c.name;
        const body = nameChanged
          ? `Updated their name to “${newName}”. Use it?`
          : 'Updated their photo. Use it?';
        // A tapped action also closes the banner (firing onDismiss); guard so the
        // swipe-dismiss fallback doesn't race the handler and clear the pending out
        // from under "Use it".
        let acted = false;
        showActionBanner({
          name: c.name,
          body,
          icon: personOutline,
          url: `profile:${c.id}`, // distinct id per contact → replace, don't stack
          actions: [
            { text: 'Use it', handler: () => { acted = true; void adoptContactProfile(c.id); } },
            { text: 'Not now', role: 'cancel', handler: () => { acted = true; void dismissContactProfile(c.id); } },
          ],
          // Swipe-dismiss (no action tapped) counts as "Not now".
          onDismiss: () => { if (!acted) void dismissContactProfile(c.id); },
        });
      }
    },
    { immediate: true },
  );
}
