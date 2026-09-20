import { test, expect } from './helpers';

/**
 * The sidebar's connection light.
 *
 * This build stores everything in localStorage, so there is no channel to drop
 * and "Reconnecting" cannot be provoked here — the state machine behind it is
 * covered by src/hooks/useRealtimeSync.test.ts. What the browser can show is
 * the offline override, which is what the pill is mostly there for.
 */
test('the status pill tracks the connection', async ({ page, context }) => {
  const pill = page.getByTestId('sync-status');

  await expect(pill).toBeVisible();
  await expect(pill).toHaveText('Live');
  await expect(pill).toHaveAttribute('data-status', 'live');

  await context.setOffline(true);
  await expect(pill).toHaveText('Offline');
  await expect(pill).toHaveAttribute('data-status', 'offline');
  // The banner stays the loud half of the pair.
  await expect(page.getByText("You're offline", { exact: false })).toBeVisible();

  await context.setOffline(false);
  await expect(pill).toHaveText('Live');
  await expect(page.getByText("You're offline", { exact: false })).toBeHidden();
});
