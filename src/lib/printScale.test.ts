import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  PRINT_WIDTH_PX,
  printScaleFor,
  measureBoardWidth,
  applyPrintScale,
  clearPrintScale,
  installPrintScale,
} from './printScale';
import { SIDEBAR_WIDTH } from './layout';

describe('printScaleFor', () => {
  it('leaves a board that already fits at 1:1', () => {
    expect(printScaleFor(400)).toBe(1);
    expect(printScaleFor(PRINT_WIDTH_PX)).toBe(1);
  });

  it('shrinks a wider board to exactly the page width', () => {
    expect(printScaleFor(PRINT_WIDTH_PX * 2)).toBe(0.5);
    expect(printScaleFor(4360) * 4360).toBeCloseTo(PRINT_WIDTH_PX, 6);
  });

  it('accepts a different page width', () => {
    expect(printScaleFor(2000, 1000)).toBe(0.5);
  });

  it('never returns a nonsense scale for a board it cannot measure', () => {
    expect(printScaleFor(0)).toBe(1);
    expect(printScaleFor(-10)).toBe(1);
    expect(printScaleFor(Number.NaN)).toBe(1);
  });
});

/** A stand-in for `.app` with a timeline whose content is `contentWidth` wide. */
function fakeApp(contentWidth: number): HTMLElement {
  const app = document.createElement('div');
  const scroller = document.createElement('div');
  scroller.dataset.testid = 'timeline-scroll';
  const content = document.createElement('div');
  Object.defineProperty(content, 'scrollWidth', { value: contentWidth });
  scroller.appendChild(content);
  app.appendChild(scroller);
  return app;
}

describe('measureBoardWidth', () => {
  it('is the sidebar plus the full rendered date range, not the viewport', () => {
    expect(measureBoardWidth(fakeApp(4160))).toBe(SIDEBAR_WIDTH + 4160);
  });
});

describe('applyPrintScale', () => {
  afterEach(() => clearPrintScale());

  it('publishes the scale as a custom property for print.css', () => {
    const scale = applyPrintScale(fakeApp(4160));
    expect(scale).toBeCloseTo(PRINT_WIDTH_PX / (SIDEBAR_WIDTH + 4160), 6);
    expect(document.documentElement.style.getPropertyValue('--print-scale')).toBe(String(scale));
  });

  it('clears the property again so it never affects the screen', () => {
    applyPrintScale(fakeApp(4160));
    clearPrintScale();
    expect(document.documentElement.style.getPropertyValue('--print-scale')).toBe('');
  });
});

describe('installPrintScale', () => {
  it('measures on beforeprint and cleans up on afterprint', () => {
    const uninstall = installPrintScale(() => fakeApp(4160));

    window.dispatchEvent(new Event('beforeprint'));
    expect(document.documentElement.style.getPropertyValue('--print-scale')).not.toBe('');

    window.dispatchEvent(new Event('afterprint'));
    expect(document.documentElement.style.getPropertyValue('--print-scale')).toBe('');

    uninstall();
  });

  it('does nothing when the board is not on screen', () => {
    const uninstall = installPrintScale(() => null);
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.documentElement.style.getPropertyValue('--print-scale')).toBe('');
    uninstall();
  });

  it('stops listening once uninstalled', () => {
    const getApp = vi.fn(() => fakeApp(4160));
    installPrintScale(getApp)();
    window.dispatchEvent(new Event('beforeprint'));
    expect(getApp).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue('--print-scale')).toBe('');
  });
});
