import {
  test,
  expect,
  DAY_WIDTH,
  addMember,
  createBlockByDrag,
  laneFor,
  zoomButton,
  type Box,
} from './helpers';
import type { Locator, Page } from '@playwright/test';

/**
 * A block by title. Unlike `blockByTitle` in helpers.ts this is a *substring*
 * match, because a tagged block's text is its title followed by its tag chips.
 */
function taggedBlock(page: Page, title: string): Locator {
  return page.getByTestId('block').filter({ hasText: title });
}

/** The tag text input inside the block modal. */
function tagField(page: Page): Locator {
  return page.getByLabel('Tags');
}

/** Chips inside the modal's tag editor (not the ones drawn on a block). */
function modalChips(page: Page): Locator {
  return page.getByTestId('tag-chip');
}

/** Open the edit modal for a block by double-clicking it. */
async function openBlock(page: Page, block: Locator): Promise<void> {
  const b = (await block.boundingBox()) as Box;
  await page.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
  await expect(page.getByRole('heading', { name: 'Edit Block' })).toBeVisible();
}

/** Type a tag and commit it with Enter (the default) or with a comma. */
async function addTag(page: Page, tag: string, commit: 'enter' | 'comma' = 'enter'): Promise<void> {
  const field = tagField(page);
  await field.click();
  if (commit === 'comma') {
    await field.fill(tag);
    await field.press(',');
  } else {
    await field.fill(tag);
    await field.press('Enter');
  }
}

async function save(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Block' })).toBeHidden();
}

/** A block wide enough for two tag chips (>= MIN_TWO_TAG_WIDTH = 190px). */
async function createWideBlock(page: Page, member: string, title: string, offsetDays = 0) {
  const lane = await laneFor(page, member);
  await createBlockByDrag(page, lane, { title, days: 5, offsetDays });
  return taggedBlock(page, title);
}

test.describe('block tags', () => {
  test('adds tags with Enter and with a comma, rejects duplicates, removes a chip', async ({ page }) => {
    await addMember(page, 'Alice');
    const block = await createWideBlock(page, 'Alice', 'Spec');
    await openBlock(page, block);

    await addTag(page, 'infra');
    await expect(modalChips(page)).toHaveCount(1);
    // The field empties itself, ready for the next tag.
    await expect(tagField(page)).toHaveValue('');

    // A comma commits the tag just like Enter does.
    await addTag(page, 'api', 'comma');
    await expect(modalChips(page)).toHaveCount(2);

    // Same tag again, in a different case — rejected, with a reason.
    await addTag(page, 'INFRA');
    await expect(modalChips(page)).toHaveCount(2);
    await expect(page.getByRole('alert')).toContainText('already on this block');

    // Surrounding whitespace is trimmed off.
    await addTag(page, '   ops   ');
    await expect(modalChips(page)).toHaveCount(3);
    await expect(modalChips(page).nth(2)).toContainText('ops');

    // The × on a chip takes it off again.
    await page.getByRole('button', { name: 'Remove tag ops' }).click();
    await expect(modalChips(page)).toHaveCount(2);

    // Backspace in an empty field removes the last chip.
    await tagField(page).click();
    await tagField(page).press('Backspace');
    await expect(modalChips(page)).toHaveCount(1);
    await expect(modalChips(page).first()).toContainText('infra');

    await addTag(page, 'api');
    await save(page);

    await expect(block.getByTestId('block-tag')).toHaveCount(2);
    await expect(block.getByTestId('block-tag').first()).toHaveText('infra');
    await expect(block.getByTestId('block-tag').nth(1)).toHaveText('api');
  });

  test('shows two chips plus a +N overflow, and every tag in the tooltip', async ({ page }) => {
    await addMember(page, 'Alice');
    const block = await createWideBlock(page, 'Alice', 'Spec');
    await openBlock(page, block);
    for (const tag of ['infra', 'api', 'ops', 'q3']) await addTag(page, tag);
    await save(page);

    await expect(block.getByTestId('block-tag')).toHaveCount(2);
    await expect(block.getByTestId('block-tag-overflow')).toHaveText('+2');
    await expect(block).toHaveAttribute('title', 'Spec — infra, api, ops, q3');

    // Quarter zoom leaves no room for chips; the tooltip still carries them.
    await zoomButton(page, 'Quarter').click();
    await expect(block.getByTestId('block-tag')).toHaveCount(0);
    await expect(block.getByTestId('block-tag-overflow')).toHaveCount(0);
    await expect(block).toHaveAttribute('title', 'Spec — infra, api, ops, q3');
  });

  test('offers the board’s existing tags as suggestions', async ({ page }) => {
    await addMember(page, 'Alice');
    const first = await createWideBlock(page, 'Alice', 'Spec');
    await openBlock(page, first);
    await addTag(page, 'infra');
    await save(page);

    const second = await createWideBlock(page, 'Alice', 'Build', 7);
    await openBlock(page, second);
    const listId = await tagField(page).getAttribute('list');
    expect(listId).toBeTruthy();
    // React's generated ids contain characters that need escaping in a `#id`
    // selector, so match on the attribute instead.
    const options = page.locator(`datalist[id="${listId}"] option`);
    await expect(options).toHaveCount(1);
    await expect(options).toHaveAttribute('value', 'infra');
  });

  test('the filter bar dims non-matching blocks and keeps the lane layout', async ({ page }) => {
    await addMember(page, 'Alice');
    // No tags on the board yet, so no bar.
    await expect(page.getByTestId('tag-filter-bar')).toHaveCount(0);

    const spec = await createWideBlock(page, 'Alice', 'Spec');
    const build = await createWideBlock(page, 'Alice', 'Build', 7);
    await openBlock(page, spec);
    await addTag(page, 'infra');
    await save(page);
    await openBlock(page, build);
    await addTag(page, 'api');
    await save(page);

    const bar = page.getByTestId('tag-filter-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId('tag-filter-chip')).toHaveCount(2);
    await expect(page.getByTestId('tag-filter-count')).toHaveText('2 of 2 blocks');

    const geometryBefore = await build.boundingBox();

    await bar.getByRole('button', { name: 'infra' }).click();
    await expect(bar.getByRole('button', { name: 'infra' })).toHaveAttribute('aria-pressed', 'true');
    await expect(spec).toHaveCSS('opacity', '1');
    await expect(build).toHaveCSS('opacity', '0.25');
    await expect(page.getByTestId('tag-filter-count')).toHaveText('1 of 2 blocks');
    // Dimmed, not hidden: the block keeps its place in the lane.
    await expect(build).toBeVisible();
    expect(await build.boundingBox()).toEqual(geometryBefore);

    // Multi-select is OR: adding "api" brings the other block back.
    await bar.getByRole('button', { name: 'api' }).click();
    await expect(spec).toHaveCSS('opacity', '1');
    await expect(build).toHaveCSS('opacity', '1');
    await expect(page.getByTestId('tag-filter-count')).toHaveText('2 of 2 blocks');

    // Clear resets everything.
    await bar.getByRole('link', { name: 'Clear' }).or(bar.getByRole('button', { name: 'Clear' })).click();
    await expect(bar.getByRole('button', { name: 'infra' })).toHaveAttribute('aria-pressed', 'false');
    await expect(bar.getByRole('button', { name: 'api' })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('tag-filter-count')).toHaveText('2 of 2 blocks');
  });

  test('a dimmed block can still be clicked and opened', async ({ page }) => {
    await addMember(page, 'Alice');
    const spec = await createWideBlock(page, 'Alice', 'Spec');
    const build = await createWideBlock(page, 'Alice', 'Build', 7);
    await openBlock(page, spec);
    await addTag(page, 'infra');
    await save(page);

    await page.getByTestId('tag-filter-bar').getByRole('button', { name: 'infra' }).click();
    await expect(build).toHaveCSS('opacity', '0.25');

    await openBlock(page, build);
    await expect(page.getByLabel('Title')).toHaveValue('Build');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('tags persist across a reload, and the filter does not', async ({ page }) => {
    await addMember(page, 'Alice');
    const block = await createWideBlock(page, 'Alice', 'Spec');
    await openBlock(page, block);
    await addTag(page, 'infra');
    await addTag(page, 'api');
    await save(page);

    await page.getByTestId('tag-filter-bar').getByRole('button', { name: 'infra' }).click();
    await expect(page.getByTestId('tag-filter-count')).toHaveText('1 of 1 blocks');

    await page.reload();

    const reloaded = taggedBlock(page, 'Spec');
    await expect(reloaded.getByTestId('block-tag')).toHaveCount(2);
    await expect(reloaded).toHaveAttribute('title', 'Spec — infra, api');
    // Session-only: the board comes back unfiltered.
    await expect(page.getByTestId('tag-filter-bar')).toBeVisible();
    await expect(page.getByTestId('tag-filter-bar').getByRole('button', { name: 'infra' }))
      .toHaveAttribute('aria-pressed', 'false');
    await expect(reloaded).toHaveCSS('opacity', '1');

    // ...and the tags really are in storage, not just on screen.
    const stored = await page.evaluate(() => localStorage.getItem('swimlanes.artifact.data'));
    expect(stored).toContain('"tags"');
    expect(stored).toContain('infra');
  });

  test('the modal keeps the timeline header aligned with the sidebar header', async ({ page }) => {
    await addMember(page, 'Alice');
    const block = await createWideBlock(page, 'Alice', 'Spec');
    await openBlock(page, block);
    await addTag(page, 'infra');
    await save(page);

    // The filter bar sits above both panes, so the 56px header row below it
    // still starts at the same y on each side.
    const sidebarHeader = (await page.getByTestId('board-switcher').boundingBox()) as Box;
    const timelineHeader = (await page.locator('[class*="dayCell"]').first().boundingBox()) as Box;
    expect(Math.abs(sidebarHeader.y - timelineHeader.y)).toBeLessThan(DAY_WIDTH);
  });
});
