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

test('renders the example with a uniform flat base color', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-role="status"]')).toHaveText('运行');
  const samples = await page.evaluate(() => {
    const point = window.__ice3M0.projection();
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-layer="scene"]',
    );
    const gl = canvas?.getContext('webgl2');
    if (!canvas || !gl) throw new Error('WebGL2 canvas missing');
    const read = (deltaX: number, deltaY: number): number[] => {
      const pixel = new Uint8Array(4);
      const dpr = window.__ice3M0.diagnostics().dpr;
      gl.readPixels(
        Math.round((point.x + deltaX) * dpr),
        Math.round((canvas.clientHeight - point.y - deltaY) * dpr),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      return [...pixel];
    };
    return [
      read(0, 0),
      read(-60, 0),
      read(60, 0),
      read(0, -60),
      read(0, 60),
    ];
  });

  for (const sample of samples) {
    expect(sample).toEqual(samples[0]);
  }
});

test('keeps the example scene free of the probe label', async ({ page }) => {
  await page.goto('/');
  const labelIds = await page.evaluate(
    () => window.__ice3M0.diagnostics().labels.map((label) => label.id),
  );

  expect(labelIds).toEqual(['hud-status']);
});

test('renders high-contrast geometry edges', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-role="status"]')).toHaveText('运行');
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-layer="scene"]',
    );
    const gl = canvas?.getContext('webgl2');
    if (!canvas || !gl) throw new Error('WebGL2 canvas missing');
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (
        pixels[offset]! > 100
        && pixels[offset + 1]! > 140
        && pixels[offset + 2]! > 180
      ) {
        count += 1;
      }
    }
    return count;
  })).toBeGreaterThan(100);
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
