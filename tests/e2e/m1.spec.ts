import { expect, test } from '@playwright/test';

test('shows an accessible loading state until the asset is ready', async ({ page }) => {
  await page.route('**/assets/prepared-cube.glb', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.goto('http://127.0.0.1:8104/');

  const loading = page.locator('[data-role="loading"]');
  const stage = page.locator('[data-role="stage"]');
  const dispose = page.getByRole('button', { name: '释放资产' });

  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute('role', 'status');
  await expect(loading).toHaveAttribute('aria-live', 'polite');
  await expect(loading).toContainText('正在构建工业场景');
  await expect(stage).toHaveAttribute('aria-busy', 'true');
  await expect(dispose).toBeDisabled();

  await expect(loading).toBeHidden();
  await expect(stage).toHaveAttribute('aria-busy', 'false');
  await expect(dispose).toBeEnabled();
});

test('keeps a visible error state when model loading fails', async ({ page }) => {
  await page.route('**/assets/prepared-cube.glb', (route) => route.fulfill({
    status: 500,
    contentType: 'text/plain',
    body: 'unavailable',
  }));
  await page.goto('http://127.0.0.1:8104/');

  const loading = page.locator('[data-role="loading"]');

  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute('data-state', 'error');
  await expect(loading).toContainText('模型加载失败');
  await expect(page.locator('[data-role="stage"]')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect(page.locator('[data-role="status"]')).toContainText('加载失败');
  await expect(page.getByRole('button', { name: '释放资产' })).toBeDisabled();
});

test('fits the loading state within a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/assets/prepared-cube.glb', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="loading"]')).toBeVisible();

  const layout = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>('.toolbar')!;
    const stage = document.querySelector<HTMLElement>('[data-role="stage"]')!;
    const content = document.querySelector<HTMLElement>('.loading__content')!;
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      toolbarBottom: toolbar.getBoundingClientRect().bottom,
      toolbarContentBottom: Math.max(
        ...Array.from(toolbar.children, (child) => (
          child.getBoundingClientRect().bottom
        )),
      ),
      stageTop: stage.getBoundingClientRect().top,
      contentLeft: content.getBoundingClientRect().left,
      contentRight: content.getBoundingClientRect().right,
    };
  });

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.toolbarBottom).toBeLessThanOrEqual(layout.stageTop);
  expect(layout.toolbarContentBottom).toBeLessThanOrEqual(layout.stageTop);
  expect(layout.contentLeft).toBeGreaterThanOrEqual(0);
  expect(layout.contentRight).toBeLessThanOrEqual(layout.viewportWidth);
});

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
