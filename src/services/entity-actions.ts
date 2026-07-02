/**
 * Action sheet for a tapped phone number / email address in message or post text
 * (spec 1029). Phone → Call / Message / Copy; email → Email / Copy. Call, Message
 * and Email hand off to the OS via tel:/sms:/mailto: (openScheme); Copy places the
 * exact detected value on the clipboard with a brief confirmation. Everything is
 * local — no server involvement.
 */
import { actionSheetController } from '@ionic/vue';
import { callOutline, chatbubbleEllipsesOutline, mailOutline, copyOutline } from 'ionicons/icons';
import { openScheme } from '@/utils/external';
import { appToast } from '@/services/toast';
import { telHref, smsHref, mailtoHref } from '@/utils/linkify';

export interface ContactEntity {
  kind: 'email' | 'phone';
  raw: string; // as written in the text
  value: string; // normalized (dial string for phone; the address for email)
}

async function copyValue(raw: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(raw);
    await appToast('Copied');
  } catch {
    /* clipboard unavailable — best effort */
  }
}

/** Present the OS-handoff actions for a detected phone/email. */
export async function presentEntityActions(entity: ContactEntity): Promise<void> {
  const buttons =
    entity.kind === 'phone'
      ? [
          { text: 'Call', icon: callOutline, handler: () => openScheme(telHref(entity.raw)) },
          { text: 'Message', icon: chatbubbleEllipsesOutline, handler: () => openScheme(smsHref(entity.raw)) },
          { text: 'Copy', icon: copyOutline, handler: () => void copyValue(entity.raw) },
        ]
      : [
          { text: 'Email', icon: mailOutline, handler: () => openScheme(mailtoHref(entity.raw)) },
          { text: 'Copy', icon: copyOutline, handler: () => void copyValue(entity.raw) },
        ];
  const sheet = await actionSheetController.create({
    header: entity.raw,
    buttons: [...buttons, { text: 'Cancel', role: 'cancel' }],
  });
  await sheet.present();
}
