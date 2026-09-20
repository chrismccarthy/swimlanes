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
  lanePoint,
  saveBlockModal,
} from './helpers';

test.describe('blocks', () => {
  test('creates a block by dragging across a lane', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');

    const start = await lanePoint(lane);
    await dragBy(page, start, { x: 3 * DAY_WIDTH });

    // The drag opens the modal pre-filled with a draft block.
    await expect(page.getByRole('heading', { name: 'Edit Block' })).toBeVisible();
    await saveBlockModal(page, { title: 'Design work', color: 'green' });

    const block = blockByTitle(page, 'Design work');
    await expect(block).toBeVisible();
    // 4 day columns: the drag start column through the column 3 days later.
    const { width } = await blockGeometry(block);
    expect(width).toBe(4 * DAY_WIDTH);
    await expect(block).toHaveCSS('background-color', 'rgb(220, 252, 231)');
  });

  test('creates a block by double-clicking a lane', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');

    const point = await lanePoint(lane);
    await page.mouse.dblclick(point.x, point.y);

    await expect(page.getByRole('heading', { name: 'Edit Block' })).toBeVisible();
    await saveBlockModal(page, { title: 'Standup prep' });

    const block = blockByTitle(page, 'Standup prep');
    await expect(block).toBeVisible();
    // The double-click draft spans the clicked day +/- 1 day.
    const { width } = await blockGeometry(block);
    expect(width).toBe(3 * DAY_WIDTH);
  });

  test('cancelling the modal creates nothing', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');

    const point = await lanePoint(lane);
    await page.mouse.dblclick(point.x, point.y);
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByTestId('block')).toHaveCount(0);
  });

  test('moves a block right by whole day widths', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockByDrag(page, lane, { title: 'Move me' });

    const block = blockByTitle(page, 'Move me');
    const before = await blockGeometry(block);
    const b = await box(block);

    const days = 3;
    await dragBy(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, { x: days * DAY_WIDTH });

    await expect
      .poll(async () => (await blockGeometry(block)).left)
      .toBe(before.left + days * DAY_WIDTH);
    expect((await blockGeometry(block)).width).toBe(before.width);
  });

  test('resizes a block from its right handle', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockByDrag(page, lane, { title: 'Grow me' });

    const block = blockByTitle(page, 'Grow me');
    const before = await blockGeometry(block);

    const handle = await box(block.getByTestId('resize-right'));
    await dragBy(
      page,
      { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      { x: DAY_WIDTH },
    );

    await expect.poll(async () => (await blockGeometry(block)).width).toBe(before.width + DAY_WIDTH);
    expect((await blockGeometry(block)).left).toBe(before.left);
  });

  test('edits a block through double-click', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockByDrag(page, lane, { title: 'Draft title' });

    await blockByTitle(page, 'Draft title').dblclick();
    await expect(page.getByRole('heading', { name: 'Edit Block' })).toBeVisible();
    await saveBlockModal(page, { title: 'Final title', color: 'red' });

    await expect(blockByTitle(page, 'Final title')).toBeVisible();
    await expect(blockByTitle(page, 'Draft title')).toHaveCount(0);
    await expect(blockByTitle(page, 'Final title')).toHaveCSS(
      'background-color',
      'rgb(254, 226, 226)',
    );
  });

  test('edits, duplicates and deletes a block from the context menu', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockByDrag(page, lane, { title: 'Spec' });

    // Edit
    await blockByTitle(page, 'Spec').click({ button: 'right' });
    await page.getByRole('button', { name: 'Edit' }).click();
    await saveBlockModal(page, { title: 'Spec review' });
    await expect(blockByTitle(page, 'Spec review')).toBeVisible();

    // Duplicate
    await blockByTitle(page, 'Spec review').click({ button: 'right' });
    await page.getByRole('button', { name: 'Duplicate' }).click();
    await expect(blockByTitle(page, 'Spec review (copy)')).toBeVisible();
    await expect(page.getByTestId('block')).toHaveCount(2);

    // Delete the copy, confirming the in-app dialog
    await blockByTitle(page, 'Spec review (copy)').click({ button: 'right' });
    await page.getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Delete this block?');
    await dialog.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByTestId('block')).toHaveCount(1);
    await expect(blockByTitle(page, 'Spec review')).toBeVisible();
  });
});
