/** Human-readable byte size, e.g. 1536 -> "1.5 KB". Mirrors the compact form
 *  used in the storage/network screens. */
export function formatBytes(n: number): string {
  if (!n || n < 0) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  // Whole numbers for bytes; one decimal otherwise (dropping a trailing .0).
  const out = i === 0 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '');
  return `${out} ${units[i]}`;
}
