import { expect, test } from '@playwright/test';

test('renders the scene and keeps layer interaction separate', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');

  await expect(page.locator('[data-role="status"]')).toHaveText('运行');
  await expect(page.locator('canvas[data-layer="scene"]')).toBeVisible();
  await expect(page.locator('canvas[data-layer="overlay"]')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__ice3M0.scenePixelAtProjection()))
    .toEqual(expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)]));
  const pixel = await page.evaluate(() => window.__ice3M0.scenePixelAtProjection());
  expect(pixel[2]).toBeGreaterThan(pixel[0]);

  const hud = await page.evaluate(() => window.__ice3M0.hudRect());
  expect(hud.width).toBeGreaterThan(0);
  expect(hud.height).toBeGreaterThan(0);

  await page.getByRole('button', { name: '销毁并重建' }).click();
  await expect(page.locator('[data-role="status"]')).toHaveText('已重建');
  expect(errors).toEqual([]);
});

test('2D controls shield 3D and transparent areas pass through', async ({ page }) => {
  await page.goto('/');
  const center = await page.evaluate(() => window.__ice3M0.projection());
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');

  await page.mouse.click(stage.x + center.x, stage.y + center.y);
  await expect(page.locator('[data-role="status"]')).toHaveText('已选中 demo-block');

  const hud = await page.evaluate(() => window.__ice3M0.hudRect());
  await page.mouse.click(stage.x + hud.x + 4, stage.y + hud.y + 4);
  await expect(page.locator('[data-role="status"]')).toHaveText('HUD 已点击');
  expect(await page.evaluate(() => window.__ice3M0.getSelection())).toEqual([]);

  await page.mouse.click(stage.x + center.x, stage.y + center.y);
  await expect(page.locator('[data-role="status"]')).toHaveText('已选中 demo-block');
});

test('mouse drag and wheel animate the camera smoothly', async ({ page }) => {
  await page.goto('/');
  const center = await page.evaluate(() => window.__ice3M0.projection());
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');
  const beforeDrag = await page.evaluate(
    () => window.__ice3M0.diagnostics().frameId,
  );

  await page.mouse.move(stage.x + center.x, stage.y + center.y);
  await page.mouse.down();
  await page.mouse.move(
    stage.x + center.x + 160,
    stage.y + center.y + 48,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.locator('[data-role="status"]')).toHaveText(
    '已选中 demo-block',
  );
  await expect
    .poll(() => page.evaluate(() => window.__ice3M0.diagnostics().frameId))
    .toBeGreaterThan(beforeDrag + 4);

  await page.waitForTimeout(400);
  const beforeWheel = await page.evaluate(
    () => window.__ice3M0.diagnostics().frameId,
  );
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => page.evaluate(() => window.__ice3M0.diagnostics().frameId))
    .toBeGreaterThan(beforeWheel + 4);
});

test('world label remains aligned after viewport and DPR changes', async ({ page }) => {
  await page.goto('/');
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect.poll(() => page.evaluate(() => {
    const result = window.__ice3M0.measureWorldLabelOffset();
    return Math.max(
      Math.abs(result.screenX - result.labelX),
      Math.abs(result.screenY - result.labelY),
    );
  })).toBeLessThanOrEqual(1);
});

test('recovers after context loss', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const before = await page.evaluate(() => window.__ice3M0.diagnostics().frameId);

  await page.evaluate(() => window.__ice3M0.loseContext());
  await expect
    .poll(() => page.evaluate(() => window.__ice3M0.diagnostics().contextLossCount))
    .toBe(1);

  await page.evaluate(() => window.__ice3M0.restoreContext());
  await expect
    .poll(() => page.evaluate(() => window.__ice3M0.diagnostics().frameId))
    .toBeGreaterThan(before);
  await expect.poll(() => page.evaluate(() => {
    const pixel = window.__ice3M0.scenePixelAtProjection();
    return pixel[2] - pixel[0];
  })).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
