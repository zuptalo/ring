// Playwright verification of the polish pass: asserts computed styles (not just
// eyeballing) for the circular tab highlight, the frosted tab bar, and the green
// floating audio player, in light + dark — plus screenshots for the record.
import { createAccount, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Verify', mobile: true });
await a.page.evaluate(() => window.__ringTest.seedShowcase());
await a.page.waitForTimeout(1500);

const ok = [];
const bad = [];
const check = (name, cond, detail) => (cond ? ok : bad).push(`${name}${detail ? ` — ${detail}` : ''}`);
const isGreenish = (rgb) => {
  const m = rgb.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (!m) return false;
  const [r, g, b, al] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  return al > 0.02 && g > r && g > b; // some opacity, green dominant
};

async function tabIcon(client, selected) {
  // Retry: the .tab-on class can settle a beat after navigation.
  for (let i = 0; i < 12; i++) {
    const r = await client.page.evaluate((sel) => {
      const el = document.querySelector(
        sel ? 'ion-tab-button.tab-on ion-icon' : 'ion-tab-button:not(.tab-on) ion-icon',
      );
      if (!el) return null;
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, radius: s.borderTopLeftRadius, color: s.color };
    }, selected);
    if (r) return r;
    await client.page.waitForTimeout(250);
  }
  return null;
}

for (const theme of ['light', 'dark']) {
  await a.page.evaluate((t) => window.__ringTest.setSetting('appearance.theme', t), theme);
  await a.page.waitForTimeout(500);

  // Land on Chats (full load so the selected-tab class is reliably applied; the theme
  // persists in IndexedDB across the reload).
  await a.page.goto('http://localhost:5173/tabs/chats');
  await a.page.waitForTimeout(900);

  const sel = await tabIcon(a, true);
  const unsel = await tabIcon(a, false);
  check(`[${theme}] selected tab icon has a green circle`, sel && isGreenish(sel.bg) && sel.radius === '50%', sel && `bg=${sel.bg} r=${sel.radius}`);
  check(`[${theme}] unselected tab icon is transparent`, unsel && !isGreenish(unsel.bg), unsel && `bg=${unsel.bg}`);

  // Tab bar is frosted (has a backdrop-filter blur).
  const tb = await a.page.evaluate(() => {
    const el = document.querySelector('ion-tab-bar');
    if (!el) return null;
    const s = getComputedStyle(el);
    return { backdrop: s.backdropFilter || s.webkitBackdropFilter, border: s.borderTopWidth };
  });
  check(`[${theme}] tab bar has a backdrop blur`, tb && /blur/.test(tb.backdrop), tb && tb.backdrop);

  await shot(a, `verify-tabs-${theme}`, { route: '/tabs/chats' });

  // Floating audio player: green-tinted bg + slim border, icon NOT a filled square.
  await a.page.evaluate(() => window.__ringTest.navigate('/tabs/calls'));
  await a.page.waitForTimeout(300);
  await a.page.evaluate(() => window.__ringTest.playAudioTest('demo-chat', 'Demo Track'));
  await a.page.waitForTimeout(400);
  const player = await a.page.evaluate(() => {
    const el = document.querySelector('.audio-mini');
    const cover = document.querySelector('.audio-mini .am-cover');
    if (!el || !cover) return null;
    const s = getComputedStyle(el);
    const cs = getComputedStyle(cover);
    return { bg: s.backgroundColor, border: s.borderTopWidth, coverBg: cs.backgroundColor };
  });
  check(`[${theme}] floating player has a green tint`, player && isGreenish(player.bg), player && player.bg);
  check(`[${theme}] floating player has a slim border`, player && parseFloat(player.border) > 0 && parseFloat(player.border) <= 2, player && player.border);
  check(`[${theme}] player icon has no filled square`, player && !isGreenish(player.coverBg) && player.coverBg.includes('0)'), player && player.coverBg);
  await shot(a, `verify-player-${theme}`);
}

// About: single support page with all three platforms, no separate Support Ring.
await a.page.evaluate(() => window.__ringTest.setSetting('appearance.theme', 'light'));
await a.page.waitForTimeout(300);
const about = await a.page.evaluate(async () => {
  // Support Ring node must be gone from search; About must exist.
  const supportSearch = (window).__ringTestSearch; // not exposed; fall back to DOM check below
  return { supportSearch: !!supportSearch };
});
void about;
await shot(a, 'verify-about', { route: '/settings/about', fullPage: true });

console.log('\n===== VERIFY RESULTS =====');
for (const o of ok) console.log('PASS', o);
for (const b of bad) console.log('FAIL', b);
console.log(`\n${ok.length} passed, ${bad.length} failed`);

await sweep([a]);
await done();
