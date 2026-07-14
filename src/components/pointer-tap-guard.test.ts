// Spec 2032: BARE `@pointerdown.prevent` (no handler — used purely as a
// focus/selection guard next to a `@click` action) is banned app-wide.
//
// Why: per the Pointer Events spec, canceling `pointerdown` for a touch pointer
// suppresses the compatibility mouse events. iPhone Safari synthesizes the click
// anyway (legacy touch path) and Chromium tolerates it too — but iPadOS Safari's
// desktop-class pipeline honors the suppression, so every control built this way
// is a DEAD BUTTON on iPad (field report: composer Send, the react buttons, the
// mention picker, the banner quick-reply). The iPad engine cannot run in CI
// (Playwright WebKit is unavailable on this host), so this source-level guard is
// the regression test: it pins the *class* of bug on the only surface we can.
//
// The correct idiom for "act on click but don't steal focus / dismiss the
// keyboard" is `@mousedown.prevent`: synthetic mouse events fire AFTER the touch
// sequence, so preventing mousedown blocks the focus shift on every platform and
// can never cancel the click. `@pointerdown.prevent="handler"` (acting ON the
// down, like PinPad) stays legal — there is no click to lose.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function vueFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...vueFiles(p));
    else if (e.name.endsWith('.vue')) out.push(p);
  }
  return out;
}

describe('spec 2032 — no bare @pointerdown.prevent (kills taps on iPadOS)', () => {
  it('every focus-guard uses @mousedown.prevent instead', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    for (const f of vueFiles(root)) {
      const src = readFileSync(f, 'utf8');
      // Bare modifier only: `@pointerdown.prevent` NOT followed by `="handler"`.
      const re = /@pointerdown\.prevent(?!\s*=)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${f.replace(root, 'src')}:${line}`);
      }
    }
    expect(offenders, `bare @pointerdown.prevent found (dead buttons on iPad):\n${offenders.join('\n')}`).toEqual([]);
  });
});
