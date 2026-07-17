/**
 * Shared reaction picker so the Wall reacts exactly like chat: a quick-react popover
 * (your 5 most-used emoji, via QuickReactBar) with a "+" that opens the full emoji
 * picker. The caller supplies an `onPick(emoji)` callback. Keeps the "most-used at your
 * fingertips" behavior consistent everywhere.
 */
import { popoverController, modalController } from '@ionic/vue';
import QuickReactBar from '@/components/QuickReactBar.vue';
import EmojiPickerModal from '@/components/EmojiPickerModal.vue';
import { quickReactEmojis } from '@/db/queries';

export interface QuickReactOpts {
  myEmojis?: string[]; // the user's current reactions (highlighted)
  existing?: string[]; // distinct emoji already on the item
  atEmojiCap?: boolean; // item at the distinct-emoji cap → only `existing` offered
  onPick: (emoji: string) => void | Promise<void>;
}

export function useReactionPicker() {
  async function openQuick(ev: Event, opts: QuickReactOpts): Promise<void> {
    const pop = await popoverController.create({
      component: QuickReactBar,
      cssClass: 'reaction-popover quick-react-popover',
      componentProps: {
        myEmojis: opts.myEmojis,
        quick: await quickReactEmojis(5),
        existing: opts.existing,
        atEmojiCap: opts.atEmojiCap,
      },
      event: ev,
      reference: 'event',
      side: 'top',
      alignment: 'center',
      showBackdrop: false,
    });
    await pop.present();
    const { data } = await pop.onWillDismiss();
    if (!data) return;
    if (data.action === 'react') {
      await opts.onPick(data.emoji);
    } else if (data.action === 'more') {
      const modal = await modalController.create({
        component: EmojiPickerModal,
        cssClass: 'emoji-picker-sheet',
        breakpoints: [0, 0.6, 0.95],
        initialBreakpoint: 0.6,
      });
      await modal.present();
      const res = await modal.onWillDismiss();
      if (res.data?.emoji) await opts.onPick(res.data.emoji);
    }
  }

  return { openQuick };
}
