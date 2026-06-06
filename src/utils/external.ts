/**
 * Open a URL outside the PWA.
 *
 * In an installed / standalone PWA, `window.open(url, '_blank')` spawns an
 * in-app browser that, for universal links (e.g. maps.apple.com), hands off to
 * the native app and leaves an empty browser window behind; and a declarative
 * `<a target="_blank">` often does nothing at all. A transient, programmatically
 * clicked anchor is the most reliable way to reach the system browser and to
 * hand off universal links cleanly (no leftover blank window).
 *
 * Note: iOS does not let a web app target the user's *default* browser or detect
 * it; this reaches the system browser surface (Safari View), the platform max.
 */
export function openExternal(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
