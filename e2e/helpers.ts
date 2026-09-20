import { test as base, expect, type Locator, type Page } from '@playwright/test';

/** Must match DAY_WIDTH in src/lib/layout.ts */
export const DAY_WIDTH = 40;

/** Must match ZOOM_DAY_WIDTH in src/lib/layout.ts */
export const ZOOM_DAY_WIDTH = { day: 40, week: 16, quarter: 8 } as const;

/** Must match SIDEBAR_WIDTH in src/lib/layout.ts */
export const SIDEBAR_WIDTH = 200;

/** Where the app keeps its data in the localStorage-backed artifact build */
const STORAGE_KEY = 'swimlanes.artifact.data';

/**
 * Every test gets a fresh browser context (Playwright's default) *and* an
 * explicitly cleared localStorage, so no state can leak between tests.
 */
export const test = base.extend<{ cleanApp: void }>({
  cleanApp: [
    async ({ page }, use) => {
      await page.goto('/');
      // The app stores everything under STORAGE_KEY; clear() also drops the
      // generated viewer id so each test starts from a blank board.
      await page.evaluate((key) => {
        localStorage.removeItem(key);
        localStorage.clear();
      }, STORAGE_KEY);
      await page.reload();
      await expect(page.getByPlaceholder('Add member...')).toBeVisible();
      // Proof that state does not leak between tests.
      await expect(page.getByTestId('member-row')).toHaveCount(0);
      await expect(page.getByTestId('block')).toHaveCount(0);
      await use();
    },
    { auto: true },
  ],
});

export { expect };

// --- Locators -------------------------------------------------------------

export function memberRow(page: Page, name: string): Locator {
  return page.getByTestId('member-row').filter({ hasText: name });
}

/** Matches on the exact title, so "Spec" does not also match "Spec (copy)". */
export function blockByTitle(page: Page, title: string): Locator {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.getByTestId('block').filter({ hasText: new RegExp(`^${escaped}$`) });
}

/** The swim lane belonging to the member with this name. */
export async function laneFor(page: Page, name: string): Promise<Locator> {
  const id = await memberRow(page, name).getAttribute('data-member-id');
  expect(id, `member "${name}" should exist`).toBeTruthy();
  return page.locator(`[data-testid="swimlane"][data-member-id="${id}"]`);
}

/** The Day/Week/Quarter segmented control button in the sidebar header. */
export function zoomButton(page: Page, label: 'Day' | 'Week' | 'Quarter'): Locator {
  return page.getByRole('button', { name: label, exact: true });
}

/** The scrollable timeline viewport (horizontal scroll = the visible date range). */
export function timelineScroll(page: Page): Locator {
  return page.getByTestId('timeline-scroll');
}

// --- Geometry -------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  expect(b, 'element should have a bounding box').not.toBeNull();
  return b as Box;
}

/**
 * A point inside a lane, on a day column that is scrolled into view.
 * `offsetDays` shifts the point right by whole day columns.
 */
export async function lanePoint(lane: Locator, offsetDays = 0) {
  const b = await box(lane);
  // The lane spans the whole (scrolled) timeline, so start from a viewport x
  // that is safely right of the sidebar and snap it to a day boundary.
  const anchorX = SIDEBAR_WIDTH + 120;
  const dayIndex = Math.floor((anchorX - b.x) / DAY_WIDTH) + offsetDays;
  return {
    x: b.x + dayIndex * DAY_WIDTH + DAY_WIDTH / 2,
    y: b.y + b.height / 2,
  };
}

/** The inline `left`/`width` a block is positioned with, in px. */
export async function blockGeometry(block: Locator): Promise<{ left: number; width: number }> {
  return block.evaluate((el) => ({
    left: parseFloat((el as HTMLElement).style.left),
    width: parseFloat((el as HTMLElement).style.width),
  }));
}

// --- Actions --------------------------------------------------------------

export async function addMember(page: Page, name: string): Promise<void> {
  await page.getByPlaceholder('Add member...').fill(name);
  await page.getByPlaceholder('Add member...').press('Enter');
  await expect(memberRow(page, name)).toBeVisible();
}

/**
 * Press, cross the 3px drag threshold, then travel to the target.
 * Mirrors what the pointer-event drag hooks expect (see src/hooks/useDrag*.ts).
 */
export async function dragBy(
  page: Page,
  from: { x: number; y: number },
  delta: { x?: number; y?: number },
): Promise<void> {
  const dx = delta.x ?? 0;
  const dy = delta.y ?? 0;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // First move crosses the threshold, the rest travel in steps so every
  // intermediate pointermove is delivered.
  await page.mouse.move(from.x + Math.sign(dx || 1) * 5, from.y + Math.sign(dy) * 5);
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 8 });
  await page.mouse.up();
}

/** Fill in the block modal and save it. */
export async function saveBlockModal(
  page: Page,
  options: { title?: string; color?: string } = {},
): Promise<void> {
  // `exact` matters: blocks carry an aria-label ("<title>, <member>, <dates>"),
  // which a substring match on "Title" would also pick up.
  const titleInput = page.getByLabel('Title', { exact: true });
  await expect(titleInput).toBeVisible();
  if (options.title !== undefined) {
    await titleInput.fill(options.title);
  }
  if (options.color !== undefined) {
    await page.getByTitle(options.color, { exact: true }).click();
  }
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(titleInput).toBeHidden();
}

/**
 * Create a block by dragging across a lane, then saving the modal that opens.
 * Returns the day-column index the block starts on.
 */
export async function createBlockByDrag(
  page: Page,
  lane: Locator,
  options: { title: string; color?: string; days?: number; offsetDays?: number },
): Promise<void> {
  const days = options.days ?? 3;
  const start = await lanePoint(lane, options.offsetDays ?? 0);
  await dragBy(page, start, { x: days * DAY_WIDTH });
  await saveBlockModal(page, { title: options.title, color: options.color });
  await expect(blockByTitle(page, options.title)).toBeVisible();
}

// --- Boards ---------------------------------------------------------------

/** The board picker in the sidebar header. */
export function boardSwitcher(page: Page): Locator {
  return page.getByTestId('board-switcher');
}

/** The board the switcher is currently showing. */
export async function currentBoardName(page: Page): Promise<string> {
  const value = await boardSwitcher(page).inputValue();
  return boardSwitcher(page).locator(`option[value="${value}"]`).innerText();
}

/**
 * Pick "New board…" and answer the in-app name prompt.
 * The app switches to the new board, so wait for the switcher to show it.
 */
export async function createBoard(page: Page, name: string): Promise<void> {
  await boardSwitcher(page).selectOption('__new__');
  const dialog = page.getByRole('dialog', { name: 'New board' });
  await dialog.getByLabel('Board name').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect
    .poll(() => currentBoardName(page), { message: `board "${name}" should be current` })
    .toBe(name);
}

/** Switch to an existing board by name. */
export async function switchToBoard(page: Page, name: string): Promise<void> {
  await boardSwitcher(page).selectOption({ label: name });
  await expect.poll(() => currentBoardName(page)).toBe(name);
}

/** Open the Board settings modal from the switcher. */
export async function openBoardSettings(page: Page): Promise<void> {
  await boardSwitcher(page).selectOption('__settings__');
  await expect(page.getByTestId('board-settings')).toBeVisible();
}
