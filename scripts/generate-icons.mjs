/**
 * Generate the full cross-platform PWA icon set from public/favicon.svg.
 *
 * favicon.svg is the single source of truth - edit it, then run:
 *     node scripts/generate-icons.mjs
 *
 * Outputs (all into public/):
 *   Browser favicon : favicon-16/32/48.png, favicon.ico
 *   Apple (iOS)     : apple-touch-icon.png (180) + 152 + 167   (opaque, full-bleed)
 *   Android / Chrome: pwa-192/512 (any) + pwa-maskable-192/512 (full-bleed, safe-zone inset)
 *   Microsoft tiles : mstile-70/150/310 + mstile-310x150 (wide)
 *
 * "any" icons keep the rounded-tile look with transparent corners (straight from
 * the SVG). Maskable + tile icons bleed the brand green to every edge and inset
 * the artwork into the maskable safe zone, so any OS mask shape (circle/squircle)
 * shows green, never a clipped corner. Apple icons are flattened opaque because
 * iOS applies its own corner rounding and dislikes transparency.
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const GREEN = '#10b981'; // brand primary (matches the tile + manifest theme_color)
const DENSITY = 768; // render the 100-unit SVG large, then downscale for crispness

const svg = readFileSync(join(PUB, 'favicon.svg'), 'utf8');

// Foreground = everything after the green tile rect. A full-bleed green square
// with the artwork scaled down about the centre, so it never touches the edges.
const marker = 'width="100" height="100"/>';
const foreground = svg.slice(svg.indexOf(marker) + marker.length, svg.lastIndexOf('</svg>'));
const bleedSvg = (scale) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">` +
  `<rect x="0" y="0" width="100" height="100" fill="${GREEN}"/>` +
  `<g transform="translate(50 50) scale(${scale}) translate(-50 -50)">${foreground}</g></svg>`;

// Maskable safe zone is tight (OS may circle-crop) → 0.78. iOS only rounds the
// corners (no crop), so a lighter inset keeps the mark comfortably off the top
// edge while still reading full.
const maskable = bleedSvg(0.78);
const appleArt = bleedSvg(0.84); // already opaque (full-bleed green) - no flatten needed

const pipe = (input, size) =>
  sharp(Buffer.from(input), { density: DENSITY }).resize(size, size);

const any = (size, name) => pipe(svg, size).png().toFile(join(PUB, name)); // transparent corners
const apple = (size, name) => pipe(appleArt, size).png().toFile(join(PUB, name)); // opaque + padded
const bleed = (size, name) => pipe(maskable, size).png().toFile(join(PUB, name)); // full-bleed green

await Promise.all([
  // Android / Chrome PWA - manifest "any"
  any(192, 'pwa-192x192.png'),
  any(512, 'pwa-512x512.png'),
  // Browser favicons
  any(16, 'favicon-16x16.png'),
  any(32, 'favicon-32x32.png'),
  any(48, 'favicon-48x48.png'),
  // Android / Chrome PWA - manifest "maskable"
  bleed(192, 'pwa-maskable-192x192.png'),
  bleed(512, 'pwa-maskable-512x512.png'),
  // Apple - opaque, iOS rounds the corners itself
  apple(180, 'apple-touch-icon.png'),
  apple(152, 'apple-touch-icon-152x152.png'),
  apple(167, 'apple-touch-icon-167x167.png'),
  // Microsoft square tiles
  bleed(70, 'mstile-70x70.png'),
  bleed(150, 'mstile-150x150.png'),
  bleed(310, 'mstile-310x310.png'),
]);

// Microsoft wide tile (310x150): centre the square logo on a green canvas.
const logo = await pipe(maskable, 150).png().toBuffer();
await sharp({ create: { width: 310, height: 150, channels: 4, background: GREEN } })
  .composite([{ input: logo }])
  .png()
  .toFile(join(PUB, 'mstile-310x150.png'));

// favicon.ico embedding 16/32/48 PNG frames (PNG-in-ICO, supported everywhere).
const icoSizes = [16, 32, 48];
const icoFrames = await Promise.all(icoSizes.map((s) => pipe(svg, s).png().toBuffer()));
const dir = Buffer.alloc(6 + 16 * icoFrames.length);
dir.writeUInt16LE(0, 0); // reserved
dir.writeUInt16LE(1, 2); // type: icon
dir.writeUInt16LE(icoFrames.length, 4); // image count
let offset = dir.length;
icoFrames.forEach((buf, i) => {
  const s = icoSizes[i];
  const e = 6 + i * 16;
  dir.writeUInt8(s >= 256 ? 0 : s, e + 0); // width
  dir.writeUInt8(s >= 256 ? 0 : s, e + 1); // height
  dir.writeUInt8(0, e + 2); // palette
  dir.writeUInt8(0, e + 3); // reserved
  dir.writeUInt16LE(1, e + 4); // colour planes
  dir.writeUInt16LE(32, e + 6); // bits per pixel
  dir.writeUInt32LE(buf.length, e + 8); // frame byte size
  dir.writeUInt32LE(offset, e + 12); // frame offset
  offset += buf.length;
});
writeFileSync(join(PUB, 'favicon.ico'), Buffer.concat([dir, ...icoFrames]));

console.log('Generated icon set in public/.');
