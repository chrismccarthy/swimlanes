import { test, expect, addMember, boardSwitcher, currentBoardName, memberRow } from './helpers';

/**
 * Generic behavior of the in-app confirm/prompt dialogs that replace
 * `window.confirm` / `window.prompt` (blocked inside the sandboxed artifact
 * iframe). Exercised through the member-delete confirm and the new-board
 * prompt, since both are ordinary user-visible flows.
 */
test.describe('in-app dialogs', () => {
  test('Escape cancels a confirm dialog', async ({ page }) => {
    await addMember(page, 'Alice');
    await memberRow(page, 'Alice').getByTitle('Remove member').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(dialog).toBeHidden();
    await expect(memberRow(page, 'Alice')).toBeVisible();
  });

  test('clicking the overlay cancels a confirm dialog', async ({ page }) => {
    await addMember(page, 'Alice');
    await memberRow(page, 'Alice').getByTitle('Remove member').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // The overlay covers the whole viewport; the modal card is centered, so
    // a corner click lands outside it, on the overlay itself.
    await page.mouse.click(4, 4);

    await expect(dialog).toBeHidden();
    await expect(memberRow(page, 'Alice')).toBeVisible();
  });

  test('Tab from the last focusable element wraps to the first', async ({ page }) => {
    await addMember(page, 'Alice');
    await memberRow(page, 'Alice').getByTitle('Remove member').click();
    const dialog = page.getByRole('dialog');
    const cancelBtn = dialog.getByRole('button', { name: 'Cancel' });
    const removeBtn = dialog.getByRole('button', { name: 'Remove' });

    // The primary button gets initial focus.
    await expect(removeBtn).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(cancelBtn).toBeFocused();

    // Wraps back to the primary button instead of leaving the dialog.
    await page.keyboard.press('Tab');
    await expect(removeBtn).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(cancelBtn).toBeFocused();
  });

  test('Enter submits the new-board prompt', async ({ page }) => {
    await boardSwitcher(page).selectOption('__new__');
    const dialog = page.getByRole('dialog', { name: 'New board' });
    await expect(dialog).toBeVisible();

    const input = dialog.getByLabel('Board name');
    await expect(input).toBeFocused();
    await input.fill('Platform');
    await page.keyboard.press('Enter');

    await expect(dialog).toBeHidden();
    await expect
      .poll(() => currentBoardName(page), { message: 'board "Platform" should be current' })
      .toBe('Platform');
  });

  test('an empty new-board prompt shows a validation message and does not submit', async ({ page }) => {
    await boardSwitcher(page).selectOption('__new__');
    const dialog = page.getByRole('dialog', { name: 'New board' });

    await dialog.getByRole('button', { name: 'Create' }).click();

    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Board name is required');
  });
});
