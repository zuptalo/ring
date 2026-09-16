/**
 * Spec 2024: a DYNAMIC `:class` binding on an `ion-*` element is banned app-wide.
 *
 * Why: Ionic components are Stencil custom elements that add their own classes to
 * the host at runtime — the mode (`ios` / `md`), `hydrated`, and per-component
 * layout markers like `item-label` or `tab-has-label`. Vue does not know about
 * them. With a `:class` binding present, every re-render patches the host's
 * `class` attribute from Vue's own value, wiping whatever Stencil put there.
 *
 * It bit us once already: dynamic classes on `ion-tab-button` wiped
 * `tab-has-label`/`tab-has-icon` and the bottom tab bar's labels vanished (spec
 * 2024). The failure is nasty because it needs a re-render to appear, so it never
 * shows up on first paint — it shows up the moment the user does something.
 *
 * A STATIC `class="..."` is fine: Vue writes it once at mount, before Stencil
 * hydrates, and never touches it again.
 *
 * The correct idiom is a data attribute plus an attribute selector:
 *     <ion-item :data-lifted-row="lifted || undefined">   +   [data-lifted-row] { … }
 * Vue patches only that one attribute and the host's class list is left alone.
 * (`|| undefined` so the attribute is absent, not `="false"`, when off.)
 */
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

/** The `<template>` half of an SFC. Scoped CSS legitimately mentions `ion-*`
 *  selectors and `:class` never appears in `<script>`, but bounding the search
 *  keeps the match honest. */
function template(src: string): string {
  const start = src.indexOf('<template>');
  if (start === -1) return '';
  const end = src.lastIndexOf('</template>');
  return end > start ? src.slice(start, end) : src.slice(start);
}

/** Every `<ion-… >` opening tag, whole, including attributes split over lines. */
function ionTags(tpl: string): string[] {
  return tpl.match(/<ion-[a-z-]+(?:"[^"]*"|'[^']*'|[^>"'])*>/g) ?? [];
}

describe('spec 2024 — no dynamic :class on ion-* hosts (wipes Stencil classes)', () => {
  it('every conditional style on an Ionic host goes through a data attribute', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    for (const f of vueFiles(root)) {
      const src = readFileSync(f, 'utf8');
      for (const tag of ionTags(template(src))) {
        // `:class=` or `v-bind:class=`. A plain static `class="…"` is untouched.
        if (/(?::|v-bind:)class\s*=/.test(tag)) {
          const name = tag.match(/<(ion-[a-z-]+)/)?.[1] ?? 'ion-?';
          offenders.push(`${f.slice(root.length + 1)} — <${name}>`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
