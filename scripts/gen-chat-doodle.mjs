#!/usr/bin/env node
/**
 * Generates src/assets/chat-doodle.svg — the chat wallpaper tile (spec 1047).
 *
 * The layout is a deliberately BROKEN grid: jittered cells, random skips, wide
 * rotation/scale variance, and tiny "filler" doodles sprinkled between the big
 * glyphs, so the tiling reads organic (WhatsApp-style) instead of rows of
 * icons. Deterministic PRNG (change SEED for a different arrangement, tweak
 * the knobs below for density/contrast) — run:  node scripts/gen-chat-doodle.mjs
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/assets/chat-doodle.svg');

// ---- knobs ----
const SEED = 20260713;
const TILE = 480; // bigger tile = repetition is harder to spot
const CELL = 47; // big-glyph spacing (≈10x10 cells)
const SKIP = 0.08; // fraction of big cells left empty (breaks the lattice)
const JITTER = 15; // px of positional scatter per big glyph
const FILLERS = 44; // tiny sprinkles between the big glyphs
const STROKE = '#8a8a8a';
const OPACITY = 0.34;

// mulberry32 — tiny deterministic PRNG so the tile is reproducible.
let s = SEED >>> 0;
const rnd = () => {
  s |= 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a, b) => a + rnd() * (b - a);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// ---- glyphs (24x24 boxes) ----
const DEFS = `
    <g id="shield"><path d="M12 3 L20 6.2 V13 C20 17.4 16.8 20.7 12 22 C7.2 20.7 4 17.4 4 13 V6.2 Z"/><circle cx="12" cy="12" r="3.6"/></g>
    <path id="bubble" d="M6 4.5 h12 a3 3 0 0 1 3 3 v6 a3 3 0 0 1 -3 3 h-7.5 L6.5 20.5 v-4 H6 a3 3 0 0 1 -3 -3 v-6 a3 3 0 0 1 3 -3 z"/>
    <path id="phone" d="M6.5 3.5 C4.8 4.2 4 5.7 4.3 7.5 C5 12.5 10.5 18.5 16 19.7 C17.8 20 19.3 19.2 20 17.5 L19.5 15.5 L15.8 14.8 L14 16.5 C11.5 15.5 8.5 12.5 7.5 10 L9.2 8.2 L8.5 4.5 Z"/>
    <g id="videocam"><rect x="3" y="7" width="12.5" height="10" rx="2.5"/><path d="M15.5 11.4 L21 8.2 v7.6 L15.5 12.6"/></g>
    <path id="heart" d="M12 20.5 C5.6 15 3.2 11.2 4.8 8.2 C6.4 5.4 10.2 5.8 12 8.8 C13.8 5.8 17.6 5.4 19.2 8.2 C20.8 11.2 18.4 15 12 20.5 Z"/>
    <path id="star" d="M12 3.5 L14.4 9 L20.3 9.6 L15.9 13.6 L17.2 19.4 L12 16.3 L6.8 19.4 L8.1 13.6 L3.7 9.6 L9.6 9 Z"/>
    <g id="note"><circle cx="8" cy="17.5" r="2.8"/><path d="M10.8 17.5 V5.5 L19 3.5 V15"/><circle cx="16.2" cy="15" r="2.8"/><path d="M10.8 8.5 L19 6.5"/></g>
    <g id="plane"><path d="M3.5 11.5 L20.5 4 L14.5 20.5 L11.2 13.2 Z"/><path d="M11.2 13.2 L20.5 4"/></g>
    <g id="lock"><rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5 V8 a3.5 3.5 0 0 1 7 0 v2.5"/></g>
    <g id="smiley"><circle cx="12" cy="12" r="8.6"/><path d="M8.4 13.6 a4.6 4.6 0 0 0 7.2 0"/><path d="M9 9.4 h.01 M15 9.4 h.01"/></g>
    <g id="gamepad"><path d="M7 7.5 h10 a4.5 4.5 0 0 1 4.4 5.4 l-.8 4 a2.6 2.6 0 0 1 -4.6 1.1 L14.4 16 H9.6 L8 18 a2.6 2.6 0 0 1 -4.6 -1.1 l-.8 -4 A4.5 4.5 0 0 1 7 7.5 Z"/><path d="M8.5 10.5 v4 M6.5 12.5 h4 M15.5 11 h.01 M17.5 13.5 h.01"/></g>
    <g id="pin"><path d="M12 21 C7.8 16.4 5.5 13.3 5.5 10.4 A6.5 6.5 0 0 1 18.5 10.4 C18.5 13.3 16.2 16.4 12 21 Z"/><circle cx="12" cy="10.4" r="2.4"/></g>
    <g id="bell"><path d="M12 3.8 a6 6 0 0 1 6 6 v3.6 l1.8 2.8 H4.2 L6 13.4 V9.8 a6 6 0 0 1 6 -6 Z"/><path d="M10 19.5 a2 2 0 0 0 4 0"/></g>
    <g id="camera"><rect x="3" y="7" width="18" height="13" rx="2.5"/><circle cx="12" cy="13.5" r="4"/><path d="M8.5 7 L10 4.5 h4 L15.5 7"/></g>
    <g id="mic"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5 a6.5 6.5 0 0 0 13 0 M12 18 v3"/></g>
    <g id="clock"><circle cx="12" cy="12" r="8.6"/><path d="M12 7 v5 l3.4 2"/></g>
    <g id="coffee"><path d="M4.5 9 H16 v5.5 a5 5 0 0 1 -5 5 h-1.5 a5 5 0 0 1 -5 -5 Z"/><path d="M16 10 h1.6 a2.6 2.6 0 0 1 0 5.2 H16 M7.5 6.5 c0 -1.2 1 -1.2 1 -2.4 M11 6.5 c0 -1.2 1 -1.2 1 -2.4"/></g>
    <g id="flower"><circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="5.8" r="2.9"/><circle cx="17.8" cy="9.9" r="2.9"/><circle cx="15.6" cy="16.7" r="2.9"/><circle cx="8.4" cy="16.7" r="2.9"/><circle cx="6.2" cy="9.9" r="2.9"/></g>
    <g id="gift"><rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M12 9 v11 M4 13 h16 M12 9 C9 9 6.5 7.8 7.5 5.6 C8.4 3.8 11.3 4.6 12 9 C12.7 4.6 15.6 3.8 16.5 5.6 C17.5 7.8 15 9 12 9 Z"/></g>
    <path id="moon" d="M14.5 3.5 A9 9 0 1 0 20.5 15.5 A7.2 7.2 0 0 1 14.5 3.5 Z"/>
    <g id="dice"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 8.5 h.01 M15.5 15.5 h.01 M12 12 h.01 M15.5 8.5 h.01 M8.5 15.5 h.01"/></g>
    <g id="headphones"><path d="M4.5 16 v-3.5 a7.5 7.5 0 0 1 15 0 V16"/><rect x="3.5" y="14" width="4" height="6" rx="1.6"/><rect x="16.5" y="14" width="4" height="6" rx="1.6"/></g>
    <g id="sun"><circle cx="12" cy="12" r="4.2"/><path d="M12 3 v2.4 M12 18.6 V21 M3 12 h2.4 M18.6 12 H21 M5.6 5.6 l1.7 1.7 M16.7 16.7 l1.7 1.7 M18.4 5.6 l-1.7 1.7 M7.3 16.7 l-1.7 1.7"/></g>
    <path id="bolt" d="M13.2 2.5 L5 13.5 h5 L9.5 21.5 L18 10.5 h-5 Z"/>
    <g id="mail"><rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3.5 7 L12 13 L20.5 7"/></g>
    <path id="pencil" d="M4 20 L5.2 15.8 L16.2 4.8 A2.2 2.2 0 0 1 19.3 7.9 L8.3 18.9 Z M14.8 6.2 L17.9 9.3"/>
    <g id="cake"><path d="M5 12 h14 v8 H5 Z"/><path d="M5 15.5 c1.5 1.6 3 -1.6 4.6 0 c1.6 1.6 3 -1.6 4.7 0 c1.6 1.6 3.1 -1.6 4.7 0 M12 12 V8.5 M12 6.8 c-.8 -.8 -.4 -2 0 -2.6 c.4 .6 .8 1.8 0 2.6 Z"/></g>
    <g id="globe"><circle cx="12" cy="12" r="8.6"/><path d="M3.4 12 h17.2 M12 3.4 c-6 5 -6 12.2 0 17.2 M12 3.4 c6 5 6 12.2 0 17.2"/></g>
    <g id="sparkle"><path d="M12 5 V19 M5 12 H19 M8.2 8.2 L15.8 15.8 M15.8 8.2 L8.2 15.8"/></g>
    <path id="wave" d="M3 12 C6 8 9 16 12 12 C15 8 18 16 21 12"/>
    <g id="ringlet"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3"/></g>
    <path id="leaf" d="M5 19 C5 9 11 4 19 5 C20 13 15 19 5 19 Z M5 19 C9 14 12 11 16 8"/>
    <g id="dots3"><path d="M6 12 h.01 M12 12 h.01 M18 12 h.01"/></g>
`;

const BIG = [
  'shield', 'bubble', 'phone', 'videocam', 'heart', 'star', 'note', 'plane', 'lock',
  'smiley', 'gamepad', 'pin', 'bell', 'camera', 'mic', 'clock', 'coffee', 'flower',
  'gift', 'moon', 'dice', 'headphones', 'sun', 'bolt', 'mail', 'pencil', 'cake', 'globe',
];
const SMALL = ['sparkle', 'wave', 'ringlet', 'leaf', 'dots3', 'star', 'heart'];

const uses = [];
const cols = Math.floor(TILE / CELL);
// Big glyphs: jittered cells with random skips; neighbours get different glyphs
// because the pick is uniform over 28 defs.
let prev = '';
for (let j = 0; j < cols; j++) {
  for (let i = 0; i < cols; i++) {
    if (rnd() < SKIP) continue;
    let id = pick(BIG);
    if (id === prev) id = pick(BIG); // avoid immediate twins side by side
    prev = id;
    const scale = between(0.62, 1.12);
    const size = 24 * scale;
    const cx = i * CELL + CELL / 2 + between(-JITTER, JITTER);
    const cy = j * CELL + CELL / 2 + between(-JITTER, JITTER);
    // Keep the glyph box inside the tile so nothing is cut at a seam.
    const x = Math.min(Math.max(cx - size / 2, 1), TILE - size - 1);
    const y = Math.min(Math.max(cy - size / 2, 1), TILE - size - 1);
    const rot = rnd() < 0.12 ? between(-100, 100) : between(-32, 32);
    uses.push(
      `<use href="#${id}" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot.toFixed(0)} 12 12) scale(${scale.toFixed(2)})"/>`,
    );
  }
}
// Tiny fillers in the gaps: small enough to slip between big glyphs anywhere.
for (let k = 0; k < FILLERS; k++) {
  const id = pick(SMALL);
  const scale = between(0.3, 0.48);
  const size = 24 * scale;
  const x = between(1, TILE - size - 1);
  const y = between(1, TILE - size - 1);
  const rot = between(-45, 45);
  uses.push(
    `<use href="#${id}" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot.toFixed(0)} 12 12) scale(${scale.toFixed(2)})"/>`,
  );
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">
  <!-- GENERATED by scripts/gen-chat-doodle.mjs (spec 1047) — edit the knobs
       there and re-run; do not hand-edit the placements below. A ${TILE}px tile
       of jittered, skip-broken glyph placements + tiny fillers so the repeat
       reads organic. One neutral mid-grey stroke serves both themes. -->
  <defs>${DEFS}  </defs>
  <g fill="none" stroke="${STROKE}" stroke-opacity="${OPACITY}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    ${uses.join('\n    ')}
  </g>
</svg>
`;
writeFileSync(OUT, svg);
console.log(`wrote ${OUT} (${uses.length} placements, ${TILE}px tile)`);
