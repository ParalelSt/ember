import { useEffect, type RefObject } from 'react';

/** Pixels the mouse must travel before a press becomes a drag. */
export const DRAG_THRESHOLD = 6;

/** Mouse drag-to-scroll for a sideways row (desktop). Press, move more than
 *  DRAG_THRESHOLD, and the row follows the pointer with a grabbing cursor;
 *  the click that ends a drag is swallowed so releasing never opens a card.
 *  A plain click (no move) is untouched. Touch is not handled: the browser
 *  already scrolls by touch. */
export function useDragScroll(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let startX = 0;
    let startLeft = 0;
    let pressed = false;
    let dragging = false;
    let swallow = false;

    const onMove = (e: MouseEvent) => {
      if (!pressed) return;
      const dx = e.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) <= DRAG_THRESHOLD) return;
        dragging = true;
        el.style.cursor = 'grabbing';
        el.style.userSelect = 'none';
      }
      el.scrollLeft = startLeft - dx;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      pressed = false;
      if (dragging) {
        dragging = false;
        swallow = true;
        el.style.cursor = '';
        el.style.userSelect = '';
        // The click fires right after mouseup; if none comes, stop swallowing.
        setTimeout(() => { swallow = false; }, 0);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      pressed = true;
      dragging = false;
      swallow = false;
      startX = e.clientX;
      startLeft = el.scrollLeft;
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
    const onClick = (e: MouseEvent) => {
      if (!swallow) return;
      swallow = false;
      e.preventDefault();
      e.stopPropagation();
    };
    // Links and images would start a native drag-and-drop instead.
    const onDragStart = (e: Event) => e.preventDefault();

    el.addEventListener('mousedown', onDown);
    el.addEventListener('click', onClick, true);
    el.addEventListener('dragstart', onDragStart);
    return () => {
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('click', onClick, true);
      el.removeEventListener('dragstart', onDragStart);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [ref, enabled]);
}
