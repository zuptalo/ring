/**
 * Drag-to-scrub for a media progress track.
 *
 * Pointer events (not click) so a tap still jumps, but a touch/mouse DRAG
 * scrubs continuously. setPointerCapture keeps the drag alive after the
 * pointer leaves the skinny bar — the finger never has to stay on a 4px
 * line — and also stops surrounding gestures (the viewer's slide-swipe)
 * from stealing the move. Seeks are coalesced through requestAnimationFrame
 * so a fast drag doesn't flood the <video>/<audio> element with seeks.
 *
 * The track element must set `touch-action: none`, otherwise the browser
 * claims the touch for scrolling and pointermove never fires.
 */
export function useScrub(seek: (ratio: number) => void) {
  let scrubbing = false;
  let raf = 0;
  let pending: number | null = null;

  const apply = (): void => {
    raf = 0;
    if (pending != null) {
      seek(pending);
      pending = null;
    }
  };
  const queue = (el: HTMLElement, clientX: number): void => {
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    pending = (clientX - r.left) / r.width; // seek() clamps to [0,1]
    if (!raf) raf = requestAnimationFrame(apply);
  };

  function onPointerDown(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* already released/invalid pointer — the drag just won't capture */
    }
    scrubbing = true;
    queue(el, e.clientX);
  }
  function onPointerMove(e: PointerEvent): void {
    if (scrubbing) queue(e.currentTarget as HTMLElement, e.clientX);
  }
  function onPointerUp(e: PointerEvent): void {
    if (!scrubbing) return;
    queue(e.currentTarget as HTMLElement, e.clientX);
    scrubbing = false;
  }

  return { onPointerDown, onPointerMove, onPointerUp };
}
