import {
  test,
  expect,
  DAY_WIDTH,
  addMember,
  blockByTitle,
  createBlockByDrag,
  laneFor,
  memberRow,
} from './helpers';

test.describe('sprint settings', () => {
  test('changing the sprint length redraws the header bands', async ({ page }) => {
    const currentSprint = page.getByText('Current Sprint');
    await expect(currentSprint).toBeVisible();
    // Default sprint length is 14 days.
    await expect(currentSprint).toHaveCSS('width', `${14 * DAY_WIDTH}px`);
    const bandsBefore = await page.locator('[class*="sprintLabel"]').count();

    await page.getByTitle('Sprint settings').click();
    await expect(page.getByRole('heading', { name: 'Sprint Settings' })).toBeVisible();
    await page.getByLabel('Sprint Length').fill('7');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByRole('heading', { name: 'Sprint Settings' })).toBeHidden();
    await expect(currentSprint).toHaveCSS('width', `${7 * DAY_WIDTH}px`);
    expect(await page.locator('[class*="sprintLabel"]').count()).toBeGreaterThan(bandsBefore);
  });
});

test.describe('persistence', () => {
  test('a member and a block survive a reload', async ({ page }) => {
    await addMember(page, 'Alice');
    const lane = await laneFor(page, 'Alice');
    await createBlockByDrag(page, lane, { title: 'Roadmap', color: 'purple' });

    await page.reload();

    await expect(memberRow(page, 'Alice')).toBeVisible();
    await expect(blockByTitle(page, 'Roadmap')).toBeVisible();
    await expect(blockByTitle(page, 'Roadmap')).toHaveCSS(
      'background-color',
      'rgb(237, 233, 254)',
    );
  });
});

test.describe('offline', () => {
  test('blocks edits while offline and recovers when back online', async ({ page, context }) => {
    await addMember(page, 'Alice');

    await context.setOffline(true);
    const banner = page.getByText("You're offline", { exact: false });
    await expect(banner).toBeVisible();

    // Attempting an edit is refused, with a toast, and nothing is added.
    await page.getByPlaceholder('Add member...').fill('Bob');
    await page.getByPlaceholder('Add member...').press('Enter');

    await expect(page.getByText('Cannot save while offline')).toBeVisible();
    await expect(page.getByTestId('member-row')).toHaveCount(1);

    await context.setOffline(false);
    await expect(banner).toBeHidden();

    // Edits work again once the connection is back.
    await addMember(page, 'Bob');
    await expect(page.getByTestId('member-row')).toHaveCount(2);
  });
});
