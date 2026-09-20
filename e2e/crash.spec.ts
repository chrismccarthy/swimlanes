import { test, expect, addMember, memberRow, timelineScroll } from './helpers';

test.describe('timeline error boundary', () => {
  test('a Timeline render crash shows an inline fallback while the sidebar stays usable, and Try again recovers', async ({ page }) => {
    // Sidebar state to prove it survives the crash.
    await addMember(page, 'Alice');

    // Re-navigate with the test-only crash flag; Timeline throws on mount.
    await page.goto('/?crash=timeline');

    // Not a blank white screen: the boundary's inline fallback shows, scoped
    // to where the timeline would be.
    await expect(page.getByText('Something went wrong')).toBeVisible();
    await expect(page.getByText(/Timeline crashed/)).toBeVisible();

    // Inline variant: only "Try again", no Reload / Copy diagnostics.
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copy diagnostics' })).toHaveCount(0);

    // The sidebar is unaffected: existing members are visible and it still works.
    await expect(memberRow(page, 'Alice')).toBeVisible();
    await addMember(page, 'Bob');
    await expect(memberRow(page, 'Bob')).toBeVisible();

    // Try again resets the boundary *and* clears the hook that caused the
    // crash, so the timeline actually recovers instead of crashing again.
    await page.getByRole('button', { name: 'Try again' }).click();

    await expect(page.getByText('Something went wrong')).toBeHidden();
    await expect(timelineScroll(page)).toBeVisible();
    // The sidebar state from before the crash/recovery is still intact.
    await expect(memberRow(page, 'Alice')).toBeVisible();
    await expect(memberRow(page, 'Bob')).toBeVisible();
  });
});
