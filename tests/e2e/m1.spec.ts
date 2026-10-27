import { expect, test } from '@playwright/test';

test('shows compact camera hints after the asset is ready', async ({ page }) => {
  await page.route('**/assets/prepared-cube.glb', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.goto('http://127.0.0.1:8104/');

  const hint = page.locator('[data-role="controls-hint"]');

  await expect(hint).toBeHidden();
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已加载');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('操作提示');
  await expect(hint).toContainText('WASD');
  await expect(hint).toContainText('方向键');
  await expect(hint).toContainText('鼠标拖拽');
  await expect(hint).toContainText('滚轮');
  await expect(hint).toHaveCSS('pointer-events', 'none');

  const layout = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>('[data-role="stage"]')!;
    const panel = document.querySelector<HTMLElement>(
      '[data-role="controls-hint"]',
    )!;
    const stageRect = stage.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    return {
      stageCenterX: stageRect.left + stageRect.width / 2,
      panelRight: panelRect.right,
    };
  });
  expect(layout.panelRight).toBeLessThan(layout.stageCenterX);
});

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

test('fits loading and control hints within a narrow viewport', async ({ page }) => {
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

  await expect(page.locator('[data-role="status"]')).toHaveText('资产已加载');
  const hint = page.locator('[data-role="controls-hint"]');
  await expect(hint).toBeVisible();
  const hintBox = await hint.boundingBox();
  if (!hintBox) throw new Error('Control hint bounds missing');
  expect(hintBox.x).toBeGreaterThanOrEqual(0);
  expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(390);
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
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().backend.picking,
  )).toBe(true);
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
  const targetBeforeLetter = await page.evaluate(
    () => window.__ice3M1.cameraTarget(),
  );

  await page.keyboard.down('w');
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.cameraPosition()),
  ).not.toEqual(before);
  await page.keyboard.up('w');
  const afterLetter = await page.evaluate(() => window.__ice3M1.cameraPosition());
  const targetAfterLetter = await page.evaluate(
    () => window.__ice3M1.cameraTarget(),
  );
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
  expect(distance(afterLetter, targetAfterLetter)).toBeCloseTo(
    distance(before, targetBeforeLetter),
    5,
  );
  expect(distance(afterArrow, targetAfterArrow)).toBeCloseTo(
    distance(afterLetter, targetBeforeArrow),
    5,
  );
});

test('selects one equipment unit with a label and cyan highlight', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已加载');
  const center = await page.evaluate(() => window.__ice3M1.assetCenter());
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');
  const before = await page.evaluate(
    () => window.__ice3M1.scenePixelAtProjection(),
  );

  await page.mouse.click(stage.x + center.x, stage.y + center.y);

  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(1);
  expect(await page.evaluate(() => window.__ice3M1.selectedLabelText()))
    .toBeTruthy();
  const labelRect = await page.evaluate(() => (
    window.__ice3M1.diagnostics().labels.find(
      (label) => label.id === 'selection-label',
    )?.rect
  ));
  expect(labelRect?.x).toBeGreaterThan(0);
  expect(labelRect?.y).toBeGreaterThan(0);
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.scenePixelAtProjection()),
  ).not.toEqual(before);
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().lastPickTimeMs,
  )).toBeGreaterThan(0);
});

test('clears selection on empty click and does not select while dragging', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已加载');
  const center = await page.evaluate(() => window.__ice3M1.assetCenter());
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');

  await page.mouse.click(
    stage.x + center.x,
    stage.y + center.y,
    { button: 'right' },
  );
  expect(await page.evaluate(() => window.__ice3M1.selectedIds())).toEqual([]);

  await page.mouse.move(stage.x + center.x, stage.y + center.y);
  await page.mouse.down();
  await page.mouse.move(
    stage.x + center.x + 40,
    stage.y + center.y,
    { steps: 5 },
  );
  await page.mouse.up();
  expect(await page.evaluate(() => window.__ice3M1.selectedIds())).toEqual([]);

  await page.mouse.click(stage.x + center.x, stage.y + center.y);
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(1);
  await page.mouse.click(stage.x + stage.width - 20, stage.y + 20);
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(0);
  expect(await page.evaluate(() => window.__ice3M1.selectedLabelText()))
    .toBeUndefined();
});

test('does not select during a two-pointer pinch gesture', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已加载');

  await page.evaluate(() => {
    const overlay = document.querySelector<HTMLCanvasElement>(
      'canvas[data-layer="overlay"]',
    )!;
    overlay.setPointerCapture = () => {};
    overlay.releasePointerCapture = () => {};
    const bounds = overlay.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const dispatch = (
      type: string,
      pointerId: number,
      clientX: number,
      clientY: number,
    ) => overlay.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      button: 0,
      clientX,
      clientY,
    }));
    dispatch('pointerdown', 11, centerX, centerY);
    dispatch('pointerdown', 12, centerX + 20, centerY);
    dispatch('pointermove', 12, centerX + 80, centerY);
    dispatch('pointerup', 11, centerX, centerY);
    dispatch('pointerup', 12, centerX + 80, centerY);
  });

  expect(await page.evaluate(() => window.__ice3M1.selectedIds())).toEqual([]);
});
