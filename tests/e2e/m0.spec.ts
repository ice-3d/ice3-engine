import { expect, test } from '@playwright/test';

test('renders the scene and keeps layer interaction separate', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');

  await expect(page.locator('[data-role="status"]')).toHaveText('运行');
  await expect(page.locator('canvas[data-layer="scene"]')).toBeVisible();
  await expect(page.locator('canvas[data-layer="overlay"]')).toBeVisible();

  const hud = await page.evaluate(() => window.__ice3M0.hudRect());
  expect(hud.width).toBeGreaterThan(0);
  expect(hud.height).toBeGreaterThan(0);

  await page.getByRole('button', { name: '销毁并重建' }).click();
  await expect(page.locator('[data-role="status"]')).toHaveText('已重建');
  expect(errors).toEqual([]);
});
