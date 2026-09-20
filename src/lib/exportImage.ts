import { toBlob } from 'html-to-image';

/**
 * Snapshot the board as a PNG.
 *
 * What the user sees horizontally, every lane vertically: the timeline is a
 * scroll container, so a plain capture of the DOM would either clip at the
 * viewport or serialise the whole (very wide) rendered date range. Instead the
 * root is put into "capture mode" — a class that stops the scroll containers
 * clipping and lets the app grow to its full height — and the timeline content
 * is shifted left by the current scroll offset, so the visible date range ends
 * up exactly where the viewport had it.
 *
 * The rules for the class live in `components/Export/ExportMenu.module.css`
 * (`:global(.app.swimlanes-capturing)`), next to the menu that triggers this.
 */
export const CAPTURE_CLASS = 'swimlanes-capturing';

/** Retina-ish output: sharp enough to paste into a doc or a slide. */
const PIXEL_RATIO = 2;

function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export async function captureBoardPng(root: HTMLElement): Promise<Blob> {
  const scroller = root.querySelector<HTMLElement>('[data-testid="timeline-scroll"]');
  const content = scroller?.firstElementChild as HTMLElement | null;
  const scrollLeft = scroller?.scrollLeft ?? 0;
  const scrollTop = scroller?.scrollTop ?? 0;

  root.classList.add(CAPTURE_CLASS);
  if (content) {
    content.style.transform = `translateX(${-scrollLeft}px)`;
  }

  try {
    // Two frames: one for the class to take effect, one for the new layout.
    await nextFrame();

    const rect = root.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(rect.width));
    const height = Math.max(1, Math.ceil(Math.max(root.scrollHeight, rect.height)));

    const blob = await toBlob(root, {
      width,
      height,
      pixelRatio: PIXEL_RATIO,
      backgroundColor: '#ffffff',
      // No web fonts are loaded, and scanning stylesheets for them is the
      // slowest part of a capture.
      skipFonts: true,
      style: { width: `${width}px`, height: `${height}px` },
    });

    if (!blob) throw new Error('The browser produced an empty image');
    return blob;
  } finally {
    if (content) content.style.transform = '';
    root.classList.remove(CAPTURE_CLASS);
    // Toggling overflow can reset the scroll position; put it back.
    if (scroller) {
      scroller.scrollLeft = scrollLeft;
      scroller.scrollTop = scrollTop;
    }
  }
}
