/**
 * The "With …" consent line for an incoming GROUP call — the other participants' names, with
 * anyone we don't know flagged. Shared by the incoming banner and the full-screen incoming
 * view so this privacy-relevant text can't drift between the two. A group call meshes between
 * everyone, so accepting exposes you to them; naming them makes accepting informed consent.
 */
import { computed, ref, watch } from 'vue';
import { callState, callMeta } from '@/composables/useCall';
import { getContact } from '@/db/queries';
import { getSelfUserId } from '@/services/auth';

function joinNames(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function useCallParticipants() {
  const others = ref<{ name: string }[]>([]);
  watch(
    () => (callState.value === 'incoming' && callMeta.value?.isGroup ? callMeta.value?.roster : null),
    async (roster) => {
      const self = getSelfUserId() ?? '';
      const ids = (roster ?? []).filter((id) => id && id !== self);
      others.value = await Promise.all(ids.map(async (id) => ({ name: (await getContact(id))?.name ?? '' })));
    },
    { immediate: true },
  );

  const participantsLine = computed(() => {
    const list = others.value;
    if (!list.length) return '';
    const known = list.filter((o) => o.name).map((o) => o.name);
    const unknown = list.length - known.length;
    const parts = [...known];
    if (unknown > 0) parts.push(unknown === 1 ? 'someone you don’t know' : `${unknown} people you don’t know`);
    return `With ${joinNames(parts)}`;
  });

  return { participantsLine };
}
