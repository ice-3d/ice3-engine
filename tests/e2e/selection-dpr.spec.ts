import { expect, test } from '@playwright/test';

test.use({ deviceScaleFactor: 2 });

test('selects at the projected center with a two-times device scale', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');
  const center = await page.evaluate(() => window.__ice3M1.assetCenter());
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');

  await page.mouse.click(stage.x + center.x, stage.y + center.y);

  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(1);
});
