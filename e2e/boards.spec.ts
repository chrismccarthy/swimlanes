import {
  test,
  expect,
  addMember,
  blockByTitle,
  boardSwitcher,
  createBlockByDrag,
  createBoard,
  currentBoardName,
  laneFor,
  memberRow,
  openBoardSettings,
  switchToBoard,
} from './helpers';

/**
 * The localStorage-backed artifact build creates one board named "Team" on a
 * blank slate, so every test starts on it.
 */
const DEFAULT_BOARD = 'Team';

test.describe('boards', () => {
  test('starts on the default board', async ({ page }) => {
    await expect(boardSwitcher(page)).toBeVisible();
    expect(await currentBoardName(page)).toBe(DEFAULT_BOARD);
  });

  test('keeps each board’s members and blocks to itself', async ({ page }) => {
    await addMember(page, 'Ada');
    const adaLane = await laneFor(page, 'Ada');
    await createBlockByDrag(page, adaLane, { title: 'Original work' });

    await createBoard(page, 'Platform');

    // A brand-new board starts empty — nothing from "Team" leaks into it.
    await expect(page.getByTestId('member-row')).toHaveCount(0);
    await expect(page.getByTestId('block')).toHaveCount(0);

    await addMember(page, 'Grace');
    const graceLane = await laneFor(page, 'Grace');
    await createBlockByDrag(page, graceLane, { title: 'Platform work' });

    // Back to the first board: its own contents, and only its own.
    await switchToBoard(page, DEFAULT_BOARD);
    await expect(memberRow(page, 'Ada')).toBeVisible();
    await expect(memberRow(page, 'Grace')).toHaveCount(0);
    await expect(blockByTitle(page, 'Original work')).toBeVisible();
    await expect(blockByTitle(page, 'Platform work')).toHaveCount(0);

    // And forward again.
    await switchToBoard(page, 'Platform');
    await expect(memberRow(page, 'Grace')).toBeVisible();
    await expect(memberRow(page, 'Ada')).toHaveCount(0);
    await expect(blockByTitle(page, 'Platform work')).toBeVisible();
    await expect(blockByTitle(page, 'Original work')).toHaveCount(0);
  });

  test('gives each board its own sprint settings', async ({ page }) => {
    const currentSprint = page.getByText('Current Sprint');
    await expect(currentSprint).toHaveCSS('width', '560px'); // 14 days x 40px

    await page.getByTitle('Sprint settings').click();
    await page.getByLabel('Sprint Length').fill('7');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(currentSprint).toHaveCSS('width', '280px');

    // The new board gets the defaults, not the 7-day sprint set on "Team".
    await createBoard(page, 'Platform');
    await expect(currentSprint).toHaveCSS('width', '560px');

    await switchToBoard(page, DEFAULT_BOARD);
    await expect(currentSprint).toHaveCSS('width', '280px');
  });

  test('renames a board from Board settings', async ({ page }) => {
    await openBoardSettings(page);
    await page.getByLabel('Board name').fill('Renamed team');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByTestId('board-settings')).toBeHidden();
    expect(await currentBoardName(page)).toBe('Renamed team');

    await page.reload();
    expect(await currentBoardName(page)).toBe('Renamed team');
  });

  test('deletes a board after confirming and lands on the one that is left', async ({ page }) => {
    await createBoard(page, 'Platform');
    await addMember(page, 'Grace');

    await openBoardSettings(page);
    await page.getByRole('button', { name: 'Delete board' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Platform');
    await dialog.getByRole('button', { name: 'Delete' }).click();

    await expect(page.getByTestId('board-settings')).toBeHidden();
    await expect.poll(() => currentBoardName(page)).toBe(DEFAULT_BOARD);
    await expect(page.getByTestId('member-row')).toHaveCount(0);
    // The deleted board is gone from the switcher entirely.
    await expect(boardSwitcher(page).locator('option', { hasText: 'Platform' })).toHaveCount(0);
  });

  test('keeps the board when the delete confirm is dismissed', async ({ page }) => {
    await createBoard(page, 'Platform');

    await openBoardSettings(page);
    await page.getByRole('button', { name: 'Delete board' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    expect(await currentBoardName(page)).toBe('Platform');
  });

  test('will not let you delete your only board', async ({ page }) => {
    await openBoardSettings(page);
    await expect(page.getByRole('button', { name: 'Delete board' })).toBeDisabled();
  });

  test('remembers the last board across a reload', async ({ page }) => {
    await createBoard(page, 'Platform');
    await addMember(page, 'Grace');

    await page.reload();

    expect(await currentBoardName(page)).toBe('Platform');
    await expect(memberRow(page, 'Grace')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('swimlanes.board'))).toBeTruthy();
  });

  test('explains that sharing is handled by the artifact, not by email', async ({ page }) => {
    await openBoardSettings(page);

    // This build has no roster to manage, so there is no add-by-email form.
    await expect(page.getByLabel('Email address')).toHaveCount(0);
    await expect(page.getByText('share menu')).toBeVisible();
    await expect(page.getByTestId('board-member')).toHaveCount(1);
  });
});
