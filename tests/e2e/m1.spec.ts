import { expect, test } from '@playwright/test';

test('loads and renders the prepared industrial asset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:8104/');

  await expect(page.locator('[data-role="status"]')).toHaveText('资产已加载');
  await expect
    .poll(() => page.evaluate(() => window.__ice3M1.scenePixelAtProjection()))
    .toEqual(expect.arrayContaining([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ]));
  const pixel = await page.evaluate(() => window.__ice3M1.scenePixelAtProjection());
  expect(pixel[2]).toBeGreaterThan(pixel[0]);
  expect(await page.evaluate(() => window.__ice3M1.assetStats())).toEqual({
    nodeCount: 1,
    meshCount: 1,
    triangleCount: 12,
  });

  const center = await page.evaluate(() => window.__ice3M1.assetCenter());
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');
  await page.mouse.click(stage.x + center.x, stage.y + center.y);
  await expect
    .poll(() => page.evaluate(() => window.__ice3M1.selectedIds().length))
    .toBe(1);
  expect(errors).toEqual([]);
});

test('disposes the asset exactly once', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已加载');

  await page.getByRole('button', { name: '释放资产' }).click();
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已释放');
  await page.getByRole('button', { name: '释放资产' }).click();
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已释放');
});

test('uses a black background with material contrast', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已加载');
  const background = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-layer="scene"]',
    );
    const gl = canvas?.getContext('webgl2');
    if (!canvas || !gl) throw new Error('WebGL2 canvas missing');
    const pixel = new Uint8Array(4);
    gl.readPixels(5, 5, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel];
  });

  expect(background[0]).toBeLessThanOrEqual(5);
  expect(background[1]).toBeLessThanOrEqual(5);
  expect(background[2]).toBeLessThanOrEqual(5);
});

test('moves the camera with WASD and arrow keys', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已加载');
  const before = await page.evaluate(() => window.__ice3M1.cameraPosition());

  await page.keyboard.down('w');
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.cameraPosition()),
  ).not.toEqual(before);
  await page.keyboard.up('w');
  const afterLetter = await page.evaluate(() => window.__ice3M1.cameraPosition());
  const targetBeforeArrow = await page.evaluate(
    () => window.__ice3M1.cameraTarget(),
  );

  await page.keyboard.down('ArrowUp');
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.cameraPosition()),
  ).not.toEqual(afterLetter);
  await page.keyboard.up('ArrowUp');
  const afterArrow = await page.evaluate(() => window.__ice3M1.cameraPosition());
  const targetAfterArrow = await page.evaluate(
    () => window.__ice3M1.cameraTarget(),
  );
  const distance = (
    left: readonly number[],
    right: readonly number[],
  ): number => Math.hypot(
    left[0]! - right[0]!,
    left[1]! - right[1]!,
    left[2]! - right[2]!,
  );
  expect(distance(afterArrow, targetAfterArrow)).toBeCloseTo(
    distance(afterLetter, targetBeforeArrow),
    5,
  );
});
