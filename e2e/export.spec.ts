import { readFileSync } from 'node:fs';
import type { Download, Page } from '@playwright/test';
import {
  test,
  expect,
  addMember,
  createBlockByDrag,
  laneFor,
} from './helpers';

/** Green blocks — must match BLOCK_COLORS in src/lib/colors.ts. */
const GREEN_BG = { r: 0xdc, g: 0xfc, b: 0xe7 };

function openExportMenu(page: Page) {
  return page.getByTestId('export-button').click();
}

async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path();
  expect(path, 'the download should have been saved').toBeTruthy();
  return readFileSync(path);
}

/**
 * Decode a PNG in the page (Node has no decoder) and report its size plus what
 * it actually contains: a blank capture is the failure mode that matters, and
 * only the pixels can rule it out.
 */
async function inspectPng(page: Page, png: Buffer) {
  return page.evaluate(async (base64: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const colors = new Set<string>();
    let nonWhite = 0;
    let sampled = 0;
    // Sample a coarse grid: enough to characterise the image, cheap enough
    // to run on a 2x capture of the whole board.
    for (let y = 0; y < canvas.height; y += 4) {
      for (let x = 0; x < canvas.width; x += 4) {
        const i = (y * canvas.width + x) * 4;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        colors.add(`${r},${g},${b}`);
        if (r !== 255 || g !== 255 || b !== 255) nonWhite++;
        sampled++;
      }
    }
    return {
      width: canvas.width,
      height: canvas.height,
      distinctColors: colors.size,
      nonWhiteFraction: nonWhite / sampled,
      colors: [...colors],
    };
  }, png.toString('base64'));
}

function hasColorNear(colors: string[], target: { r: number; g: number; b: number }): boolean {
  return colors.some(entry => {
    const [r, g, b] = entry.split(',').map(Number);
    return (
      Math.abs(r - target.r) <= 6 && Math.abs(g - target.g) <= 6 && Math.abs(b - target.b) <= 6
    );
  });
}

/** Two members, one coloured block each, so every export has content to show. */
async function seedBoard(page: Page) {
  await addMember(page, 'Ada');
  await addMember(page, 'Grace');
  await createBlockByDrag(page, await laneFor(page, 'Ada'), {
    title: 'Sprint planning',
    color: 'green',
    days: 3,
  });
  await createBlockByDrag(page, await laneFor(page, 'Grace'), {
    title: 'Review, carefully',
    days: 1,
    offsetDays: 2,
  });
}

test.describe('export menu', () => {
  test('opens, moves focus through its items and closes on Escape', async ({ page }) => {
    await addMember(page, 'Ada');
    await openExportMenu(page);

    const menu = page.getByTestId('export-menu');
    await expect(menu).toBeVisible();
    await expect(page.getByTestId('export-button')).toHaveAttribute('aria-expanded', 'true');

    // Focus lands on the first item, and the arrows walk the list.
    const items = menu.getByRole('menuitem');
    await expect(items.first()).toHaveText('Download PNG');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(items.first()).toBeFocused();
    // Wrapping: up from the first item goes to the last.
    await page.keyboard.press('ArrowUp');
    await expect(items.last()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(page.getByTestId('export-button')).toBeFocused();
  });

  test('closes when the user clicks outside it', async ({ page }) => {
    await openExportMenu(page);
    await expect(page.getByTestId('export-menu')).toBeVisible();
    await page.getByTestId('timeline-scroll').click({ position: { x: 300, y: 300 } });
    await expect(page.getByTestId('export-menu')).toBeHidden();
  });

  test('lists every member in the per-member calendar section', async ({ page }) => {
    await addMember(page, 'Ada');
    await addMember(page, 'Grace');
    await openExportMenu(page);

    const menu = page.getByTestId('export-menu');
    await expect(menu.getByRole('menuitem', { name: /^Ada/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /^Grace/ })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Copy calendar feed URL for Ada' })).toBeVisible();
  });
});

test.describe('PNG export', () => {
  test('downloads a PNG of the board, with the lanes and block colours in it', async ({ page }) => {
    await seedBoard(page);

    const viewport = page.viewportSize()!;
    await openExportMenu(page);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: 'Download PNG' }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^swimlanes-team-\d{4}-\d{2}-\d{2}\.png$/);

    const png = await readDownload(download);
    expect(png.byteLength).toBeGreaterThan(5_000);
    // PNG signature.
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    const info = await inspectPng(page, png);
    // Captured at 2x device pixels, cropped to the visible timeline width.
    expect(info.width).toBe(viewport.width * 2);
    expect(info.height).toBeGreaterThan(200);
    expect(info.height).toBeLessThanOrEqual(viewport.height * 2);
    // Not blank: a real board has the sidebar, grid lines and block fills.
    expect(info.distinctColors).toBeGreaterThan(10);
    expect(info.nonWhiteFraction).toBeGreaterThan(0.05);
    expect(hasColorNear(info.colors, GREEN_BG), 'the green block should be in the image').toBe(true);

    // The app is left exactly as it was found.
    await expect(page.locator('.swimlanes-capturing')).toHaveCount(0);
    await expect(page.getByTestId('block')).toHaveCount(2);
  });
});

test.describe('ICS export', () => {
  test('downloads one calendar for all members, with exclusive all-day ends', async ({ page }) => {
    await seedBoard(page);
    await openExportMenu(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: /Download calendar \(\.ics\) for all members/ }).click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^swimlanes-team-\d{4}-\d{2}-\d{2}\.ics$/);
    const ics = (await readDownload(download)).toString('utf8');

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:Swimlanes — Team');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    // Titles are prefixed with the member, and the comma is escaped.
    expect(ics).toContain('SUMMARY:Ada: Sprint planning');
    expect(ics).toContain('SUMMARY:Grace: Review\\, carefully');

    // DTEND is the day after the block's last day.
    const starts = [...ics.matchAll(/DTSTART;VALUE=DATE:(\d{8})/g)].map(m => m[1]);
    const ends = [...ics.matchAll(/DTEND;VALUE=DATE:(\d{8})/g)].map(m => m[1]);
    expect(starts).toHaveLength(2);
    expect(ends).toHaveLength(2);
    const asDate = (v: string) =>
      Date.UTC(Number(v.slice(0, 4)), Number(v.slice(4, 6)) - 1, Number(v.slice(6, 8)));
    const DAY = 24 * 60 * 60 * 1000;
    // Ada's block spans 4 days inclusive -> DTEND is start + 4 days.
    expect((asDate(ends[0]) - asDate(starts[0])) / DAY).toBe(4);
    // Grace's spans 2 days inclusive -> start + 2.
    expect((asDate(ends[1]) - asDate(starts[1])) / DAY).toBe(2);
  });

  test('downloads a calendar for a single member', async ({ page }) => {
    await seedBoard(page);
    await openExportMenu(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('menuitem', { name: /^Ada/ }).click(),
    ]);

    expect(download.suggestedFilename()).toBe('ada.ics');
    const ics = (await readDownload(download)).toString('utf8');
    expect(ics).toContain('X-WR-CALNAME:Swimlanes — Ada');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    // Only Ada's block, and un-prefixed because the calendar is already hers.
    expect(ics).toContain('SUMMARY:Sprint planning');
    expect(ics).not.toContain('Review');
  });

  test('explains that subscribable feeds need the hosted version', async ({ page }) => {
    await addMember(page, 'Ada');
    await openExportMenu(page);
    await page.getByRole('menuitem', { name: 'Copy calendar feed URL for Ada' }).click();

    // This build has no server behind it, so the data layer refuses and the
    // reason is surfaced as a toast instead of failing silently.
    await expect(page.getByText(/Calendar feeds need the hosted version/)).toBeVisible();
    await expect(page.getByTestId('export-menu')).toBeHidden();
  });
});

test.describe('print / PDF export', () => {
  test('the menu item asks the browser to print', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed++;
      };
    });
    await page.reload();

    await openExportMenu(page);
    await page.getByRole('menuitem', { name: 'Print / Save as PDF' }).click();

    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __printed: number }).__printed))
      .toBe(1);
    // The menu is gone before the dialog opens, so it never lands on paper.
    await expect(page.getByTestId('export-menu')).toBeHidden();
  });

  test('print media hides the chrome, keeps the board and adds a title line', async ({ page }) => {
    await seedBoard(page);
    await page.emulateMedia({ media: 'print' });
    // The browser fires this itself when it prints; `emulateMedia` does not, so
    // raise it by hand to get the layout the paper will actually carry.
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));

    const title = page.getByTestId('print-title');
    await expect(title).toBeVisible();
    await expect(title).toContainText('Swimlanes — Team');
    await expect(title).toContainText(/\d{4}/);

    // Chrome is gone...
    await expect(page.getByTestId('export-button')).toBeHidden();
    await expect(page.getByPlaceholder('Add member...')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Day', exact: true })).toBeHidden();

    // ...the board is not.
    await expect(page.getByTestId('member-row')).toHaveCount(2);
    await expect(page.getByTestId('block')).toHaveCount(2);
    await expect(page.locator('[class*="sprintLabel"]').first()).toBeVisible();
    await expect(page.getByText('Ada', { exact: true })).toBeVisible();

    // Nothing is left scrolling: the whole timeline is laid out in one piece.
    const scrollable = await page
      .getByTestId('timeline-scroll')
      .evaluate(el => ({ overflow: getComputedStyle(el).overflowX, width: el.scrollWidth }));
    expect(scrollable.overflow).toBe('visible');
    expect(scrollable.width).toBeGreaterThan(1000);

    // ...and it is scaled down to fit the printable width, because browsers
    // clip rather than paginate content that is wider than the page.
    const layout = await page.evaluate(() => ({
      scale: Number(getComputedStyle(document.documentElement).getPropertyValue('--print-scale')),
      boardWidth: document.querySelector('.app')!.getBoundingClientRect().width,
      titleHeight: document.querySelector('.print-title')!.getBoundingClientRect().height,
    }));
    expect(layout.scale).toBeGreaterThan(0);
    expect(layout.scale).toBeLessThan(1);
    // 980px is PRINT_WIDTH_PX in src/lib/printScale.ts.
    expect(layout.boardWidth).toBeLessThanOrEqual(981);
    expect(layout.boardWidth).toBeGreaterThan(900);
    // The title sits outside the scaled board, so it stays full size.
    expect(layout.titleHeight).toBeGreaterThan(12);

    await page.screenshot({
      path: 'test-results/print-media.png',
      fullPage: true,
    });
  });

  test('produces a landscape PDF with the board in it', async ({ page }) => {
    await seedBoard(page);

    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    expect(pdf.byteLength).toBeGreaterThan(10_000);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    const text = pdf.toString('latin1');
    // Landscape: the first MediaBox is wider than it is tall.
    const mediaBox = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(text);
    expect(mediaBox, 'the PDF should declare a page size').not.toBeNull();
    const [width, height] = [Number(mediaBox![1]), Number(mediaBox![2])];
    expect(width).toBeGreaterThan(height);
  });
});
