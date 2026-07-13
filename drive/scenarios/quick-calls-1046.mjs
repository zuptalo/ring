// Visual check (spec 1046): Quick Call tiles (method badges, add tile), the add
// picker with cap-constrained methods, the manage sheet, and the Network usage
// page with the per-kind call rows. Light + dark.
import { createAccount, pair, group, poll, shot, sweep, done } from '../driver.mjs';

async function paintAvatar(p, name, color) {
  await p.page.evaluate(
    async ({ nm, col }) => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = col;
      g.beginPath();
      g.arc(64, 64, 64, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 64px -apple-system, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(nm[0], 64, 70);
      await window.__ringTest.setProfile(nm, c.toDataURL('image/png'));
    },
    { nm: name, col: color },
  );
}

const a = await createAccount({ name: 'Me', label: 'A', mobile: true });
const b = await createAccount({ name: 'Biz', label: 'B' });
const c = await createAccount({ name: 'Feri', label: 'C' });
await paintAvatar(b, 'Biz', '#e74c3c');
await paintAvatar(c, 'Feri', '#8e44ad');
await pair(a, b);
await pair(a, c);
const gid = await group(a, 'Family', [b, c]);
console.log('[ids]', b.id, c.id, gid);

await a.page.getByText("I'VE SAVED IT").click();
await a.page.waitForTimeout(500);
await a.page.goto('/tabs/calls');
await poll(() => a.page.locator('.qc-plus').count(), (n) => n === 1, { label: 'add tile' });
await shot(a, '1046-empty');

// Add Biz as a VIDEO quick call via the picker.
await a.page.locator('.qc-plus').click();
await a.page.waitForTimeout(600);
await shot(a, '1046-picker');
await a.page.locator('ion-modal ion-item', { hasText: 'Biz' }).first().click();
await a.page.waitForTimeout(600);
await shot(a, '1046-kind-sheet');
await a.page.locator('ion-action-sheet button', { hasText: 'Video call' }).click();
await poll(() => a.page.locator('.qc-tile[data-qc]').count(), (n) => n === 1, { label: 'tile 1' });

// Add the group as AUDIO.
await a.page.locator('.qc-plus').click();
await a.page.locator('ion-modal ion-item', { hasText: 'Family' }).click();
await a.page.locator('ion-action-sheet button', { hasText: 'Voice call' }).click();
await poll(() => a.page.locator('.qc-tile[data-qc]').count(), (n) => n === 2, { label: 'tile 2' });
await a.page.waitForTimeout(600);
await shot(a, '1046-tiles-light');
await a.page.emulateMedia({ colorScheme: 'dark' });
await a.page.waitForTimeout(400);
await shot(a, '1046-tiles-dark');
await a.page.emulateMedia({ colorScheme: 'light' });

// Manage sheet on the group tile (long-press).
const tile = await a.page.locator(`.qc-tile[data-qc="group:${gid}"]`).boundingBox();
await a.page.mouse.move(tile.x + tile.width / 2, tile.y + tile.height / 2);
await a.page.mouse.down();
await a.page.waitForTimeout(700);
await a.page.mouse.up();
await a.page.waitForTimeout(600);
await shot(a, '1046-manage-sheet');
await a.page.locator('ion-action-sheet button', { hasText: 'Cancel' }).click();

// Network usage with the per-kind rows.
await a.page.goto('/settings/network-usage');
await a.page.waitForTimeout(800);
await shot(a, '1046-network-usage');

await sweep([a, b, c]);
await done();
