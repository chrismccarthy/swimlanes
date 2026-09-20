import {
  test,
  expect,
  DAY_WIDTH,
  addMember,
  blockByTitle,
  blockGeometry,
  box,
  createBlockByDrag,
  dragBy,
  laneFor,
  timelineScroll,
  type Box,
} from './helpers';
import type { Page } from '@playwright/test';

/** The `data-testid` of whatever currently has the focus. */
async function focusedTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
}

/**
 * Click the timeline's header strip: it deselects, and — crucially — moves the
 * focus out of the "Add member" field, so keystrokes reach the shortcuts.
 */
async function clickTimelineBackground(page: Page): Promise<void> {
  await timelineScroll(page).click({ position: { x: 300, y: 6 } });
}

test.describe('keyboard', () => {
  test('Tab moves the focus onto a block and selects it', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockByDrag(page, lane, { title: 'Keys' });

    const block = blockByTitle(page, 'Keys');
    await expect(block).toHaveAttribute('aria-label', /Keys, Alice, .+ to .+/);

    await clickTimelineBackground(page);
    await expect(block).not.toHaveAttribute('data-selected', 'true');

    // Tab through the sidebar controls until the block takes the focus.
    let landed = false;
    for (let i = 0; i < 40 && !landed; i++) {
      await page.keyboard.press('Tab');
      landed = (await focusedTestId(page)) === 'block';
    }
    expect(landed, 'Tab should reach a block').toBe(true);

    // Focusing selects, so the shortcuts act on what the ring is around.
    await expect(block).toHaveAttribute('data-selected', 'true');
  });

  test('arrows move the selected block, Shift extends it', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockByDrag(page, lane, { title: 'Nudge' });

    const block = blockByTitle(page, 'Nudge');
    await block.click();
    const before = await blockGeometry(block);

    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await blockGeometry(block)).left).toBe(before.left + DAY_WIDTH);
    expect((await blockGeometry(block)).width).toBe(before.width);

    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await blockGeometry(block)).left).toBe(before.left);

    // Shift+Right grows the end date only: same left edge, one day wider.
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => (await blockGeometry(block)).width).toBe(before.width + DAY_WIDTH);
    expect((await blockGeometry(block)).left).toBe(before.left);

    // ...and Shift+Left shrinks it back.
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => (await blockGeometry(block)).width).toBe(before.width);
  });

  test('a burst of arrow presses lands as one move', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockByDrag(page, lane, { title: 'Burst' });

    const block = blockByTitle(page, 'Burst');
    await block.click();
    const before = await blockGeometry(block);

    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await blockGeometry(block)).left).toBe(before.left + 5 * DAY_WIDTH);

    // The whole burst is one undo step, not five.
    await page.waitForTimeout(600); // let the debounced write land
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await blockGeometry(block)).left).toBe(before.left);
  });

  test('up and down move the block between lanes', async ({ page }) => {
    await addMember(page, 'Alice');
    await addMember(page, 'Bob');
    const alice = await laneFor(page, 'Alice');
    const bob = await laneFor(page, 'Bob');
    await createBlockByDrag(page, alice, { title: 'Lane hop' });

    await blockByTitle(page, 'Lane hop').click();
    await page.keyboard.press('ArrowDown');
    await expect(bob.getByTestId('block')).toHaveCount(1);
    await expect(alice.getByTestId('block')).toHaveCount(0);

    await page.keyboard.press('ArrowUp');
    await expect(alice.getByTestId('block')).toHaveCount(1);
    await expect(bob.getByTestId('block')).toHaveCount(0);
  });

  test('Delete removes the block and the toast puts it back', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockByDrag(page, lane, { title: 'Zap' });
    const before = await blockGeometry(blockByTitle(page, 'Zap'));

    await blockByTitle(page, 'Zap').click();
    await page.keyboard.press('Delete');

    await expect(page.getByTestId('block')).toHaveCount(0);
    const undo = page.getByTestId('toast-action');
    await expect(undo).toHaveText('Undo');

    await undo.click();

    const restored = blockByTitle(page, 'Zap');
    await expect(restored).toBeVisible();
    expect(await blockGeometry(restored)).toEqual(before);

    // The restore survives a reload, i.e. it was persisted, not just optimistic.
    await page.reload();
    await expect(blockByTitle(page, 'Zap')).toBeVisible();
  });

  test('Enter opens the edit modal for the selected block', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockByDrag(page, lane, { title: 'Editable' });

    await blockByTitle(page, 'Editable').click();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'Edit Block' })).toBeVisible();
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Editable');
  });

  test('undo and redo a drag-move', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockByDrag(page, lane, { title: 'Undo me' });

    const block = blockByTitle(page, 'Undo me');
    const before = await blockGeometry(block);
    const b: Box = await box(block);

    const days = 3;
    await dragBy(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, { x: days * DAY_WIDTH });
    await expect.poll(async () => (await blockGeometry(block)).left).toBe(before.left + days * DAY_WIDTH);

    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await blockGeometry(block)).left).toBe(before.left);
    await expect(page.getByText('Undid: Move block')).toBeVisible();

    await page.keyboard.press('Control+Shift+z');
    await expect.poll(async () => (await blockGeometry(block)).left).toBe(before.left + days * DAY_WIDTH);
  });

  test('Ctrl+D duplicates and Ctrl+Z takes the copy away again', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockByDrag(page, lane, { title: 'Twin' });

    await blockByTitle(page, 'Twin').click();
    await page.keyboard.press('Control+d');
    await expect(blockByTitle(page, 'Twin (copy)')).toBeVisible();

    await page.keyboard.press('Control+z');
    await expect(blockByTitle(page, 'Twin (copy)')).toHaveCount(0);
    await expect(blockByTitle(page, 'Twin')).toBeVisible();
  });

  test('? opens the shortcuts cheat sheet, Escape closes it', async ({ page }) => {
    await addMember(page, 'Alice');
    await clickTimelineBackground(page);

    await page.keyboard.press('Shift+Slash');
    const sheet = page.getByTestId('shortcuts-modal');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
    await expect(sheet).toContainText('Move block one day');

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('Escape deselects and typing in a field is never a shortcut', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockByDrag(page, lane, { title: 'Safe' });

    const block = blockByTitle(page, 'Safe');
    await block.click();
    await expect(block).toHaveAttribute('data-selected', 'true');

    await page.keyboard.press('Escape');
    await expect(block).not.toHaveAttribute('data-selected', 'true');

    // With a block selected, keystrokes aimed at an input must stay there.
    await block.click();
    const geometry = await blockGeometry(block);
    const field = page.getByPlaceholder('Add member...');
    await field.fill('Bob');
    await field.press('ArrowRight');
    await field.press('Backspace');
    await expect(field).toHaveValue('Bo');
    await expect(page.getByTestId('block')).toHaveCount(1);
    expect(await blockGeometry(block)).toEqual(geometry);
  });
});
