/**
 * The composer's link preview: resolve the first URL a draft contains so the sender
 * sees the card BEFORE sending, not only after it attaches (spec 1022).
 *
 * Lifted out of ChatDetailPage. Small, but it is a complete little state machine —
 * a debounce timer, a supersede token, four pieces of reactive state and a privacy
 * toggle — and getting any of them out of step shows the wrong card on an outgoing
 * message. Owning it here keeps them together, and the debounce timer is cancelled
 * on teardown by this file rather than by a page that has to remember to.
 *
 * Deliberately knows nothing about sending: it exposes what the composer resolved
 * and lets the caller decide what to do with it at send time.
 */
import { onUnmounted, ref, toRaw, type Ref } from 'vue';
import { buildLinkPreview, firstLink } from '@/services/link-preview';
import { getSetting } from '@/db/queries';
import { useLiveQuery } from '@/composables/useLiveQuery';
import type { LinkPreview } from '@/services/crypto/message';

export function useComposerLinkPreview(draft: Ref<string>) {
  const linkPreviewsDisabled = useLiveQuery(
    () => getSetting<boolean>('privacy.disableLinkPreviews', false),
    ['settings'],
    false,
  );
  const composerPreviewUrl = ref(''); // the link this preview state is FOR (empty = none)
  const composerPreview = ref<LinkPreview | null>(null); // resolved result (null = tried, nothing found)
  const composerPreviewLoading = ref(false);
  const composerPreviewDismissed = ref(false); // sender explicitly removed it via the × button
  let composerPreviewTimer: ReturnType<typeof setTimeout> | undefined;
  let composerPreviewToken = 0;

  /** Debounced off the composer's input path; a stale in-flight build is discarded
   *  via composerPreviewToken if the URL changes again before it resolves. */
  function scheduleLinkPreviewCheck(): void {
    clearTimeout(composerPreviewTimer);
    composerPreviewTimer = setTimeout(() => void checkLinkPreview(), 500);
  }

  async function checkLinkPreview(): Promise<void> {
    const link = firstLink(draft.value);
    if (!link) {
      composerPreviewUrl.value = '';
      composerPreview.value = null;
      composerPreviewLoading.value = false;
      composerPreviewDismissed.value = false;
      return;
    }
    if (link === composerPreviewUrl.value) return; // same link already resolved/resolving
    composerPreviewUrl.value = link;
    composerPreview.value = null;
    composerPreviewDismissed.value = false;
    if (linkPreviewsDisabled.value) return; // respect the privacy toggle; leave it unresolved
    composerPreviewLoading.value = true;
    const mine = ++composerPreviewToken;
    const preview = await buildLinkPreview(link);
    if (mine !== composerPreviewToken || link !== composerPreviewUrl.value) return; // superseded
    composerPreview.value = preview;
    composerPreviewLoading.value = false;
  }

  function dismissComposerPreview(): void {
    composerPreviewToken++; // discard any in-flight build for this url
    composerPreviewDismissed.value = true;
    composerPreviewLoading.value = false;
  }

  /** The message just sent: drop the pending save and the resolved state. */
  function resetComposerPreview(): void {
    clearTimeout(composerPreviewTimer);
    composerPreviewToken++; // discard any in-flight build, it was for the message that just sent
    composerPreviewUrl.value = '';
    composerPreview.value = null;
    composerPreviewLoading.value = false;
    composerPreviewDismissed.value = false;
  }

  /**
   * What the composer resolved for `text`, in the shape sendMessage expects:
   *   undefined — still loading, or never attempted → let the send build its own
   *   null      — the sender saw "no preview" (or dismissed it) → don't retry
   *   LinkPreview — use this one
   */
  function previewForSend(text: string): LinkPreview | null | undefined {
    const linkNow = firstLink(text);
    if (!linkNow || linkNow !== composerPreviewUrl.value) return undefined;
    if (composerPreviewDismissed.value) return null;
    if (composerPreviewLoading.value) return undefined;
    // toRaw: composerPreview.value is a reactive Proxy (it's a ref<object>) — IndexedDB
    // can't structured-clone a Proxy, so hand the send a plain object.
    return (composerPreview.value && toRaw(composerPreview.value)) || null;
  }

  onUnmounted(() => clearTimeout(composerPreviewTimer));

  return {
    composerPreviewUrl,
    composerPreview,
    composerPreviewLoading,
    composerPreviewDismissed,
    scheduleLinkPreviewCheck,
    dismissComposerPreview,
    resetComposerPreview,
    previewForSend,
  };
}
