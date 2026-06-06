/**
 * Open a shared coordinate in an external maps app. iOS doesn't expose the user's
 * chosen default map to web apps (and maps:// always goes to Apple Maps), so to
 * reliably honour everyone's preference (including iPhone users who prefer
 * Google Maps) we offer a small Apple/Google chooser. Opened externally, never
 * inside the PWA.
 */
import { actionSheetController } from '@ionic/vue';
import { openExternal } from '@/utils/external';

export interface MapPoint {
  lat: number;
  lng: number;
  label?: string;
}

export async function chooseMapApp(loc: MapPoint): Promise<void> {
  const { lat, lng, label } = loc;
  const q = label ? encodeURIComponent(label) : `${lat},${lng}`;
  const sheet = await actionSheetController.create({
    header: 'Open in',
    buttons: [
      { text: 'Apple Maps', handler: () => openExternal(`https://maps.apple.com/?ll=${lat},${lng}&q=${q}`) },
      {
        text: 'Google Maps',
        handler: () => openExternal(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`),
      },
      { text: 'Cancel', role: 'cancel' },
    ],
  });
  await sheet.present();
}
