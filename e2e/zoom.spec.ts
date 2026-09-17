import {
  test,
  expect,
  ZOOM_DAY_WIDTH,
  addMember,
  blockByTitle,
  blockGeometry,
  box,
  createBlockByDrag,
  dragBy,
  laneFor,
  timelineScroll,
  zoomButton,
} from './helpers';

test.describe('zoom levels', () => {
  test('block width scales 40 -> 16 -> 8 px per day across zoom levels', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    // A 3-day drag makes a 4-day-wide block (start column through +3 days).
    await createBlockByDrag(page, lane, { title: 'Spec', days: 3 });
    const block = blockByTitle(page, 'Spec');

    await expect
      .poll(async () => (await blockGeometry(block)).width)
      .toBe(4 * ZOOM_DAY_WIDTH.day);

    await zoomButton(page, 'Week').click();
    await expect
      .poll(async () => (await blockGeometry(block)).width)
      .toBe(4 * ZOOM_DAY_WIDTH.week);

    await zoomButton(page, 'Quarter').click();
    await expect
      .poll(async () => (await blockGeometry(block)).width)
      .toBe(4 * ZOOM_DAY_WIDTH.quarter);
  });

  test('the segmented control reflects the active zoom via aria-pressed', async ({ page }) => {
    await expect(zoomButton(page, 'Day')).toHaveAttribute('aria-pressed', 'true');
    await expect(zoomButton(page, 'Week')).toHaveAttribute('aria-pressed', 'false');
    await expect(zoomButton(page, 'Quarter')).toHaveAttribute('aria-pressed', 'false');

    await zoomButton(page, 'Week').click();
    await expect(zoomButton(page, 'Week')).toHaveAttribute('aria-pressed', 'true');
    await expect(zoomButton(page, 'Day')).toHaveAttribute('aria-pressed', 'false');

    await zoomButton(page, 'Quarter').click();
    await expect(zoomButton(page, 'Quarter')).toHaveAttribute('aria-pressed', 'true');
    await expect(zoomButton(page, 'Week')).toHaveAttribute('aria-pressed', 'false');
  });

  test('header labels switch from per-day to per-week to per-month', async ({ page }) => {
    // Day zoom: one cell per calendar day, e.g. "17" with a day-of-week sub-label.
    await expect(page.locator('[class*="dayCell"]').first()).toBeVisible();
    await expect(page.locator('[class*="periodCell"]')).toHaveCount(0);

    // Week zoom: one cell per week, labelled like "Sep 7".
    await zoomButton(page, 'Week').click();
    await expect(page.locator('[class*="dayCell"]')).toHaveCount(0);
    await expect(page.locator('[class*="periodCell"]').first()).toBeVisible();
    await expect(page.locator('[class*="periodLabel"]').first()).toHaveText(/^[A-Za-z]{3} \d{1,2}$/);

    // Quarter zoom: one cell per month, labelled like "Sep 2026".
    await zoomButton(page, 'Quarter').click();
    await expect(page.locator('[class*="dayCell"]')).toHaveCount(0);
    await expect(page.locator('[class*="periodCell"]').first()).toBeVisible();
    await expect(page.locator('[class*="periodLabel"]').first()).toHaveText(/^[A-Za-z]{3} \d{4}$/);
  });

  test('weekend shading shows at day/week zoom and is dropped at quarter', async ({ page }) => {
    await expect(page.locator('[class*="weekendColumn"]').first()).toBeVisible();

    await zoomButton(page, 'Week').click();
    await expect(page.locator('[class*="weekendColumn"]').first()).toBeVisible();

    await zoomButton(page, 'Quarter').click();
    await expect(page.locator('[class*="weekendColumn"]')).toHaveCount(0);
  });

  test('zoom choice persists across reload', async ({ page }) => {
    await zoomButton(page, 'Quarter').click();
    await expect(zoomButton(page, 'Quarter')).toHaveAttribute('aria-pressed', 'true');

    await page.reload();

    await expect(zoomButton(page, 'Quarter')).toHaveAttribute('aria-pressed', 'true');
    await expect(zoomButton(page, 'Day')).toHaveAttribute('aria-pressed', 'false');
    await expect(zoomButton(page, 'Week')).toHaveAttribute('aria-pressed', 'false');
    const stored = await page.evaluate(() => localStorage.getItem('swimlanes.zoom'));
    expect(stored).toBe('quarter');
  });

  test('a drag-move at quarter zoom still snaps to whole days (8px)', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockByDrag(page, lane, { title: 'Move me' });

    await zoomButton(page, 'Quarter').click();
    const block = blockByTitle(page, 'Move me');
    const before = await blockGeometry(block);
    const b = await box(block);

    const days = 3;
    await dragBy(
      page,
      { x: b.x + b.width / 2, y: b.y + b.height / 2 },
      { x: days * ZOOM_DAY_WIDTH.quarter },
    );

    await expect
      .poll(async () => (await blockGeometry(block)).left)
      .toBe(before.left + days * ZOOM_DAY_WIDTH.quarter);
    expect((await blockGeometry(block)).width).toBe(before.width);
  });

  test('the left-edge date stays anchored when zoom changes', async ({ page }) => {
    const scroll = timelineScroll(page);
    // The today marker's `left` style is in the same content-pixel coordinate
    // space as scrollLeft, so (scrollLeft - markerLeft) / dayWidth is the
    // viewport's left-edge date measured as an offset from "today" — a value
    // that stays correct across zoom even if the rendered range itself later
    // grows in either direction (infinite-scroll expansion shifts the origin
    // both figures are measured from equally).
    const marker = page.locator('[class*="marker"]').first();
    const anchorRatio = async (dayWidth: number) => {
      const [scrollLeft, markerLeft] = await Promise.all([
        scroll.evaluate((el) => el.scrollLeft),
        marker.evaluate((el) => parseFloat((el as HTMLElement).style.left)),
      ]);
      return (scrollLeft - markerLeft) / dayWidth;
    };

    // The initial "scroll to today" runs on mount; give it a tick to settle.
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    const before = await anchorRatio(ZOOM_DAY_WIDTH.day);

    await zoomButton(page, 'Week').click();
    await expect.poll(() => anchorRatio(ZOOM_DAY_WIDTH.week)).toBeCloseTo(before, 0);

    await zoomButton(page, 'Quarter').click();
    await expect.poll(() => anchorRatio(ZOOM_DAY_WIDTH.quarter)).toBeCloseTo(before, 0);
  });
});
