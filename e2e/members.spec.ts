import { test, expect, addMember, box, dragBy, laneFor, memberRow } from './helpers';

test.describe('members', () => {
  test('adds a member and gives it a lane', async ({ page }) => {
    await addMember(page, 'Alice');

    await expect(memberRow(page, 'Alice')).toBeVisible();
    await expect(page.getByTestId('swimlane')).toHaveCount(1);
    const lane = await laneFor(page, 'Alice');
    await expect(lane).toBeVisible();
  });

  test('renames a member by double-clicking the name', async ({ page }) => {
    await addMember(page, 'Alice');

    // Hold on to the row by id: while it is being edited its text is in an
    // input's value, so a text filter would stop matching it.
    const id = await memberRow(page, 'Alice').getAttribute('data-member-id');
    const row = page.locator(`[data-testid="member-row"][data-member-id="${id}"]`);
    await row.getByText('Alice').dblclick();

    const input = row.getByRole('textbox');
    await expect(input).toBeFocused();
    await input.fill('Alicia');
    await input.press('Enter');

    await expect(memberRow(page, 'Alicia')).toBeVisible();
    await expect(memberRow(page, 'Alice')).toHaveCount(0);
  });

  test('deletes a member after confirming, and the lane goes with it', async ({ page }) => {
    await addMember(page, 'Alice');
    await expect(page.getByTestId('swimlane')).toHaveCount(1);

    await memberRow(page, 'Alice').getByTitle('Remove member').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Alice');
    await dialog.getByRole('button', { name: 'Remove' }).click();

    await expect(page.getByTestId('member-row')).toHaveCount(0);
    await expect(page.getByTestId('swimlane')).toHaveCount(0);
    await expect(page.getByText('No team members yet')).toBeVisible();
  });

  test('keeps the member when the delete confirm is dismissed', async ({ page }) => {
    await addMember(page, 'Alice');

    await memberRow(page, 'Alice').getByTitle('Remove member').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByTestId('member-row')).toHaveCount(1);
  });

  test('reorders members by dragging the handle', async ({ page }) => {
    await addMember(page, 'Alice');
    await addMember(page, 'Bob');

    const rows = page.getByTestId('member-row');
    await expect(rows.nth(0)).toContainText('Alice');
    await expect(rows.nth(1)).toContainText('Bob');

    const aliceRow = memberRow(page, 'Alice');
    const bobBox = await box(memberRow(page, 'Bob'));
    const handle = await box(aliceRow.getByTitle('Drag to reorder'));

    // Drag Alice's handle past the bottom edge of Bob's row.
    const from = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await dragBy(page, from, { y: bobBox.y + bobBox.height - from.y });

    await expect(rows.nth(0)).toContainText('Bob');
    await expect(rows.nth(1)).toContainText('Alice');

    // The lanes follow the same order.
    const lanes = page.getByTestId('swimlane');
    const bobLaneId = await memberRow(page, 'Bob').getAttribute('data-member-id');
    await expect(lanes.nth(0)).toHaveAttribute('data-member-id', bobLaneId!);
  });
});
