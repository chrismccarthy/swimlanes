import {
  test,
  expect,
  DAY_WIDTH,
  addMember,
  blockByTitle,
  box,
  createBlockByDrag,
  laneFor,
  memberRow,
  saveBlockModal,
} from './helpers';

/**
 * Writes are conditional on `updatedAt`; when one loses the race the app
 * refetches the winning version and toasts one of these (see
 * src/store/useAppStore.ts, CONFLICT_*_MESSAGE).
 */
const CONFLICT_BLOCK_MESSAGE = 'Someone else changed this block; showing their version';
const CONFLICT_MEMBER_MESSAGE = 'Someone else changed this member; showing their version';
const CONFLICT_SPRINT_MESSAGE = 'Someone else changed the sprint settings; showing their version';

/** Where the app keeps its data in the localStorage-backed artifact build. */
const STORAGE_KEY = 'swimlanes.artifact.data';

test.describe('conflicts', () => {
  test('two writers racing on a block: the loser toasts and shows the winner\'s title', async ({
    page,
    context,
  }) => {
    const pageA = page;
    await addMember(pageA, 'Ada');
    const lane = await laneFor(pageA, 'Ada');
    await createBlockByDrag(pageA, lane, { title: 'Original title' });

    // A second tab in the SAME browser context shares localStorage — the
    // artifact build's backend — exactly like a second client would.
    const pageB = await context.newPage();
    await pageB.goto('/');
    await expect(blockByTitle(pageB, 'Original title')).toBeVisible();

    // A starts a drag and holds mid-gesture: the block is locked, so realtime
    // merges are skipped and A is still carrying its pre-drag updatedAt.
    await pageA.bringToFront();
    const blockA = blockByTitle(pageA, 'Original title');
    const startBox = await box(blockA);
    const startX = startBox.x + startBox.width / 2;
    const startY = startBox.y + startBox.height / 2;
    await pageA.mouse.move(startX, startY);
    await pageA.mouse.down();
    await pageA.mouse.move(startX + 5, startY, { steps: 2 });
    await pageA.mouse.move(startX + 80, startY, { steps: 5 });

    // B renames the block while A is still holding the drag — this bumps
    // updatedAt, so A's eventual commit is racing against a stale token.
    await pageB.bringToFront();
    await blockByTitle(pageB, 'Original title').dblclick();
    await saveBlockModal(pageB, { title: "B's title" });
    await expect(blockByTitle(pageB, "B's title")).toBeVisible();

    // A releases the drag: commitBlock sends A's pre-drag updatedAt, which the
    // backend now rejects because B's write moved it on.
    await pageA.bringToFront();
    await pageA.mouse.up();

    await expect(pageA.getByText(CONFLICT_BLOCK_MESSAGE)).toBeVisible();
    await expect(blockByTitle(pageA, "B's title")).toBeVisible();
    await expect(blockByTitle(pageA, 'Original title')).toHaveCount(0);

    // A's stale drag did not clobber B's title in storage.
    const stored = await pageA.evaluate((key) => {
      const raw = JSON.parse(localStorage.getItem(key)!);
      return raw.blocks[0].title;
    }, STORAGE_KEY);
    expect(stored).toBe("B's title");

    // A follow-up edit, now starting from the refreshed version, succeeds
    // cleanly with no extra conflict toast.
    const toastCountBefore = await pageA.locator('[class*="toast"]').count();
    await blockByTitle(pageA, "B's title").dblclick();
    await saveBlockModal(pageA, { title: 'A wins now' });

    await expect(blockByTitle(pageA, 'A wins now')).toBeVisible();
    await expect(pageA.locator('[class*="toast"]')).toHaveCount(toastCountBefore);
  });

  test('a stale member rename toasts and shows the other writer\'s name', async ({ page }) => {
    await addMember(page, 'Ada');
    const id = await memberRow(page, 'Ada').getAttribute('data-member-id');
    const row = page.locator(`[data-testid="member-row"][data-member-id="${id}"]`);

    // Stage a "missed remote update": writing localStorage from inside this
    // page mimics another client's write, since a document never receives
    // its own `storage` event.
    await page.evaluate((key) => {
      const raw = JSON.parse(localStorage.getItem(key)!);
      raw.members[0] = {
        ...raw.members[0],
        name: 'Grace',
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      };
      localStorage.setItem(key, JSON.stringify(raw));
    }, STORAGE_KEY);

    await row.getByText('Ada').dblclick();
    await row.getByRole('textbox').fill('Ada-from-this-tab');
    await row.getByRole('textbox').press('Enter');

    await expect(page.getByText(CONFLICT_MEMBER_MESSAGE)).toBeVisible();
    await expect(row).toContainText('Grace');
    await expect(row).not.toContainText('Ada-from-this-tab');

    // A follow-up rename, now starting from the refreshed version, succeeds
    // with no extra conflict toast.
    const toastCountBefore = await page.locator('[class*="toast"]').count();
    await row.getByText('Grace').dblclick();
    await row.getByRole('textbox').fill('Grace Hopper');
    await row.getByRole('textbox').press('Enter');

    await expect(row).toContainText('Grace Hopper');
    await expect(page.locator('[class*="toast"]')).toHaveCount(toastCountBefore);
  });

  test('a stale sprint-settings save toasts and keeps the other writer\'s settings', async ({
    page,
  }) => {
    // Default sprint is 14 days; confirm the baseline before staging a conflict.
    const currentSprint = page.getByText('Current Sprint');
    await expect(currentSprint).toHaveCSS('width', `${14 * DAY_WIDTH}px`);

    // Stage a missed remote change to the sprint config. Nothing has written
    // to storage yet in this fresh test, so fall back to an empty document.
    await page.evaluate((key) => {
      const raw = JSON.parse(localStorage.getItem(key) ?? '{"members":[],"blocks":[]}');
      raw.sprint = {
        anchorDate: '2026-03-05',
        lengthDays: 7,
        updatedAt: new Date(Date.now() + 1000).toISOString(),
      };
      localStorage.setItem(key, JSON.stringify(raw));
    }, STORAGE_KEY);

    await page.getByTitle('Sprint settings').click();
    await expect(page.getByRole('heading', { name: 'Sprint Settings' })).toBeVisible();
    await page.getByLabel('Sprint Length').fill('21');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText(CONFLICT_SPRINT_MESSAGE)).toBeVisible();
    // The other writer's 7-day sprint wins, not this tab's stale 21-day save.
    await expect(currentSprint).toHaveCSS('width', `${7 * DAY_WIDTH}px`);
  });
});
