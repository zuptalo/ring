/**
 * Spec 2032 repro: does a TOUCH tap on the composer Send button work?
 * Hypothesis: @pointerdown.prevent suppresses the compatibility `click` for
 * touch pointers per the Pointer Events spec — iPhone Safari synthesizes the
 * click anyway (legacy path), iPadOS desktop-mode and Chromium do not.
 */
import { createAccount, pair, chatWith, shot, sweep, done } from '../driver.mjs';

const a = await createAccount({ name: 'Pad', mobile: true }); // touch-enabled profile
const b = await createAccount({ name: 'Phone' });
await pair(a, b);
const chat = await chatWith(a, b.id);

// Clear the onboarding gate (blocks navigation until acknowledged), then open the chat.
const saved = a.page.getByText("I'VE SAVED IT");
if (await saved.count()) await saved.click();
await a.page.waitForTimeout(600);
await a.page.evaluate((id) => window.__ringTest.navigate(`/chat/${id}`), chat);
await a.page.waitForTimeout(1500);

// Type a draft so the Send button renders.
const input = a.page.locator('ion-textarea textarea').first();
await input.click();
await input.fill('touch tap test');
await a.page.waitForTimeout(400);
await shot(a, 'ipad-send-repro-composer');

const send = a.page.locator('[aria-label="Send"]').first(); // pierces shadow DOM
const count = () => a.page.evaluate((id) => window.__ringTest.messages(id).then((m) => m.length), chat);
const before = await count();

// 1) A real TOUCH tap (what a finger does).
const box = await send.boundingBox();
await a.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
await a.page.waitForTimeout(1500);
const afterTouch = await count();

// 2) A mouse-style click (what desktop pointers do).
await send.click().catch(() => {});
await a.page.waitForTimeout(1500);
const afterClick = await count();

console.log(JSON.stringify({ before, afterTouch, afterClick, touchWorked: afterTouch > before, clickWorked: afterClick > afterTouch }));
await shot(a, 'ipad-send-repro');

await sweep([a, b]);
await done();
