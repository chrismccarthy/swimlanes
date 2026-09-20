import {
  test,
  expect,
  DAY_WIDTH,
  SIDEBAR_WIDTH,
  addMember,
  box,
  dragBy,
  laneFor,
  memberRow,
  saveBlockModal,
} from './helpers';
import type { Locator, Page } from '@playwright/test';

// --- Sprint arithmetic, mirroring the app's defaults ----------------------
//
// `DEFAULT_SPRINT_FIELDS` in src/artifact/backend.ts: a 14-day sprint anchored
// on Thu 2026-02-12, so every sprint runs Thursday to Wednesday and holds
// exactly 10 weekdays.

const ANCHOR = '2026-02-12';
const SPRINT_LENGTH_DAYS = 14;
const WEEKDAYS_PER_SPRINT = 10;

function toUTC(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = toUTC(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return toISO(date);
}

function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86_400_000);
}

/** The local calendar date, matching `isoToday()` in src/lib/dates.ts. */
function todayISO(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Start of the sprint containing today — the one the header calls "Current Sprint". */
function currentSprintStart(): string {
  const offset = Math.floor(daysBetween(ANCHOR, todayISO()) / SPRINT_LENGTH_DAYS);
  return addDays(ANCHOR, offset * SPRINT_LENGTH_DAYS);
}

// --- Locators / actions ---------------------------------------------------

function capacityToggle(page: Page): Locator {
  return page.getByRole('button', { name: 'Capacity', exact: true });
}

/** The current sprint's team total in the header's sprint band row. */
function headerTotal(page: Page): Locator {
  return page.locator('[data-testid="capacity-total"][data-current="true"]');
}

/** The current sprint's segment inside one member's lane. */
function laneSegment(lane: Locator): Locator {
  return lane.locator('[data-testid="capacity-segment"][data-current="true"]');
}

/**
 * A point on the lane background that no block can be sitting on: blocks stack
 * downwards from the top of the row in 40px tracks, and the row always keeps a
 * gap below the last one, so the bottom edge is free at any x.
 */
async function emptyLanePoint(lane: Locator) {
  const b = await box(lane);
  const anchorX = SIDEBAR_WIDTH + 120;
  const dayIndex = Math.floor((anchorX - b.x) / DAY_WIDTH);
  return {
    x: b.x + dayIndex * DAY_WIDTH + DAY_WIDTH / 2,
    y: b.y + b.height - 4,
  };
}

/**
 * Create a block with exact dates: drag one out in the lane, then correct the
 * dates in the modal that opens before saving. Dragging alone cannot land on a
 * specific calendar day reliably.
 */
async function createBlockOnDates(
  page: Page,
  lane: Locator,
  options: { title: string; startDate: string; endDate: string },
): Promise<void> {
  const start = await emptyLanePoint(lane);
  await dragBy(page, start, { x: 2 * DAY_WIDTH });
  await expect(page.getByLabel('Title')).toBeVisible();
  await page.getByLabel('Start Date').fill(options.startDate);
  await page.getByLabel('End Date').fill(options.endDate);
  await saveBlockModal(page, { title: options.title });
}

test.describe('capacity view', () => {
  test('is off until the toggle is switched on, and shows totals once it is', async ({ page }) => {
    await addMember(page, 'Alice');

    await expect(capacityToggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('capacity-total')).toHaveCount(0);
    await expect(page.getByTestId('capacity-segment')).toHaveCount(0);
    await expect(page.getByTestId('member-load')).toHaveCount(0);

    await capacityToggle(page).click();

    await expect(capacityToggle(page)).toHaveAttribute('aria-pressed', 'true');
    // Every sprint band in the rendered range carries a team total.
    await expect(page.getByTestId('capacity-total').first()).toBeVisible();
    await expect(headerTotal(page)).toHaveText(`0 / ${WEEKDAYS_PER_SPRINT} d`);
    await expect(page.getByTestId('member-load')).toHaveText('0%');
  });

  test('a 5-weekday block in the current sprint reads 5 / 10 d', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');

    // The sprint starts on a Thursday, so +4 is the Monday of its second week:
    // Monday through Friday is five working days, all inside the sprint.
    const sprintStart = currentSprintStart();
    await createBlockOnDates(page, lane, {
      title: 'Spec',
      startDate: addDays(sprintStart, 4),
      endDate: addDays(sprintStart, 8),
    });

    await capacityToggle(page).click();

    await expect(laneSegment(lane)).toHaveText(`5 / ${WEEKDAYS_PER_SPRINT} d`);
    await expect(laneSegment(lane)).toHaveAttribute('data-load', 'ok');
    // One member, so the team total is that member's figure.
    await expect(headerTotal(page)).toHaveText(`5 / ${WEEKDAYS_PER_SPRINT} d`);
    await expect(memberRow(page, 'Alice').getByTestId('member-load')).toHaveText('50%');
  });

  test('parallel blocks push the load over 100% and colour the bar `over`', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    const sprintStart = currentSprintStart();

    // Five working days...
    await createBlockOnDates(page, lane, {
      title: 'Spec',
      startDate: addDays(sprintStart, 4),
      endDate: addDays(sprintStart, 8),
    });
    // ...running in parallel with the whole sprint: 15 committed days of 10.
    await createBlockOnDates(page, lane, {
      title: 'On call',
      startDate: sprintStart,
      endDate: addDays(sprintStart, SPRINT_LENGTH_DAYS - 1),
    });

    await capacityToggle(page).click();

    await expect(laneSegment(lane)).toHaveText(`15 / ${WEEKDAYS_PER_SPRINT} d`);
    await expect(laneSegment(lane)).toHaveAttribute('data-load', 'over');
    // The bar itself takes the `over` class, which is what colours it red.
    const bar = laneSegment(lane).locator('[class*="fill"]');
    await expect(bar).toHaveClass(/over/);
    await expect(headerTotal(page)).toHaveAttribute('data-load', 'over');
    await expect(headerTotal(page).locator('[class*="fill"]')).toHaveClass(/over/);
    await expect(memberRow(page, 'Alice').getByTestId('member-load')).toHaveText('150%');
    await expect(memberRow(page, 'Alice').getByTestId('member-load'))
      .toHaveAttribute('data-load', 'over');
  });

  test('blocks are pushed below the strip instead of overlapping it', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockOnDates(page, lane, {
      title: 'Spec',
      startDate: currentSprintStart(),
      endDate: addDays(currentSprintStart(), 4),
    });

    const laneHeightBefore = (await lane.boundingBox())!.height;
    await capacityToggle(page).click();

    const laneHeightAfter = (await lane.boundingBox())!.height;
    expect(laneHeightAfter - laneHeightBefore).toBe(14);

    // The strip owns the top 14px; the block starts below it.
    const strip = (await laneSegment(lane).boundingBox())!;
    const block = (await page.getByTestId('block').first().boundingBox())!;
    expect(block.y).toBeGreaterThanOrEqual(strip.y + strip.height);

    // The sidebar row stays the same height as the lane.
    const row = (await memberRow(page, 'Alice').boundingBox())!;
    expect(row.height).toBe(laneHeightAfter);
  });

  test('at quarter zoom the strip keeps the bar and drops the text', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    const sprintStart = currentSprintStart();
    await createBlockOnDates(page, lane, {
      title: 'Spec',
      startDate: addDays(sprintStart, 4),
      endDate: addDays(sprintStart, 8),
    });
    await capacityToggle(page).click();
    await expect(laneSegment(lane)).toHaveText(`5 / ${WEEKDAYS_PER_SPRINT} d`);

    await page.getByRole('button', { name: 'Quarter', exact: true }).click();

    // No room for the numbers at 8px per day — the bar carries the signal.
    await expect(laneSegment(lane)).toHaveText('');
    await expect(laneSegment(lane).locator('[class*="fill"]')).toBeVisible();
    await expect(laneSegment(lane)).toHaveAttribute('data-load', 'ok');
  });

  test('the toggle persists across a reload', async ({ page }) => {
    await addMember(page, 'Alice');
    await capacityToggle(page).click();
    await expect(capacityToggle(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('swimlanes.capacity'))).toBe('true');

    await page.reload();

    await expect(capacityToggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(headerTotal(page)).toBeVisible();

    await capacityToggle(page).click();
    await expect(capacityToggle(page)).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await expect(capacityToggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('capacity-total')).toHaveCount(0);
  });
});
