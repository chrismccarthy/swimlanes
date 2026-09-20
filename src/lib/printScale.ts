import { SIDEBAR_WIDTH } from './layout';

/**
 * Fit the whole board onto the paper.
 *
 * On paper there is no scrolling, and browsers do not paginate horizontally:
 * content wider than the page is simply cut off. The board is usually far wider
 * than a page (a hundred days at 40px each), so before printing we measure it
 * and hand `print.css` a `--print-scale` to shrink it to the page width.
 *
 * `zoom` rather than `transform: scale()` deliberately — zoom shrinks the
 * layout box too, so the printed document ends where the board does instead of
 * trailing a page and a half of blank paper.
 *
 * Zoom out to Week or Quarter before printing and the scale comes out at 1:1.
 */

/**
 * Printable width, in CSS px, of a landscape page at 96dpi with the 10mm
 * margins `print.css` asks for. US Letter (11in) is narrower than A4 landscape
 * once rotated, so sizing for Letter fits both.
 */
export const PRINT_WIDTH_PX = 980;

/** Never enlarge a board that already fits; only shrink one that does not. */
export function printScaleFor(boardWidth: number, pageWidth: number = PRINT_WIDTH_PX): number {
  if (!Number.isFinite(boardWidth) || boardWidth <= 0) return 1;
  return Math.min(1, pageWidth / boardWidth);
}

/**
 * Width the board would occupy with nothing clipped: the sidebar plus the full
 * rendered date range, which the timeline's content element already carries as
 * its own width even while the viewport scrolls over it.
 */
export function measureBoardWidth(app: HTMLElement): number {
  const content = app.querySelector<HTMLElement>('[data-testid="timeline-scroll"] > *');
  return SIDEBAR_WIDTH + (content?.scrollWidth ?? app.scrollWidth);
}

export function applyPrintScale(app: HTMLElement): number {
  const scale = printScaleFor(measureBoardWidth(app));
  document.documentElement.style.setProperty('--print-scale', String(scale));
  return scale;
}

export function clearPrintScale(): void {
  document.documentElement.style.removeProperty('--print-scale');
}

/**
 * Measure on `beforeprint` — which fires for Ctrl+P, for `window.print()` and
 * for a headless `page.pdf()` alike — and clean up again afterwards so the
 * variable never lingers on screen.
 */
export function installPrintScale(getApp: () => HTMLElement | null): () => void {
  const onBeforePrint = () => {
    const app = getApp();
    if (app) applyPrintScale(app);
  };
  window.addEventListener('beforeprint', onBeforePrint);
  window.addEventListener('afterprint', clearPrintScale);
  return () => {
    window.removeEventListener('beforeprint', onBeforePrint);
    window.removeEventListener('afterprint', clearPrintScale);
    clearPrintScale();
  };
}
