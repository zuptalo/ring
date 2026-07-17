/**
 * Pick an image in a PWA via a transient, document-attached <input type="file">.
 * This is the only reliable cross-platform way to take/choose a photo without a
 * native plugin. The input MUST be attached to the document (on iOS Safari a
 * detached input often doesn't fire `change` on first use).
 *
 * Robust against the Android camera path: when returning from the camera app the
 * window regains focus BEFORE the `change` event fires (sometimes by a few
 * seconds), so a short focus-based cleanup would tear the input down before the
 * photo lands - the reported "can't take a picture, but library works" bug. We
 * wait generously after focus and only give up when no file was selected.
 */
export function pickImageFile(capture: boolean): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (capture) input.setAttribute('capture', 'user'); // selfie camera for avatars
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);

    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.onchange = () => finish(input.files?.[0] ?? null);

    // The picker/camera gives no signal on cancel, so when the window regains
    // focus we wait (long enough for a slow Android camera `change` to arrive),
    // then resolve null only if nothing was actually selected.
    const onFocus = () => {
      window.removeEventListener('focus', onFocus);
      setTimeout(() => {
        if (!settled && !(input.files && input.files.length > 0)) finish(null);
      }, 4000);
    };
    window.addEventListener('focus', onFocus);

    // Safety net so a stray input can never linger forever.
    setTimeout(() => finish(null), 120_000);

    input.click();
  });
}

/** Read a File as a data URL (for storing an avatar inline). */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
