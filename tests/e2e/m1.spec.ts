import { expect, test, type Page } from '@playwright/test';

const HIERARCHICAL_ASSET_URL =
  'http://127.0.0.1:8104/?asset=/assets/hierarchical-demo/tileset.json';

function hierarchicalTilesetRequest(url: string, resourceType: string): boolean {
  return resourceType !== 'document'
    && new URL(url).pathname.endsWith(
      '/assets/hierarchical-demo/tileset.json',
    );
}

test.beforeEach(async ({ page }) => {
  await page.route(
    '**/assets/local-preview.local.json',
    (route) => route.fulfill({ status: 404 }),
  );
});

async function waitForAssetProjectionToSettle(page: Page): Promise<void> {
  await page.waitForFunction(() => new Promise<boolean>((resolve) => {
    const read = () => window.__ice3M1.assetCenter();
    const first = read();
    requestAnimationFrame(() => {
      const second = read();
      requestAnimationFrame(() => {
        const third = read();
        const delta = (
          left: ReturnType<typeof read>,
          right: ReturnType<typeof read>,
        ) => Math.hypot(left.x - right.x, left.y - right.y);
        resolve(
          delta(first, second) < 0.01
          && delta(second, third) < 0.01,
        );
      });
    });
  }));
}

test('shows compact camera hints after the asset is ready', async ({ page }) => {
  await page.route('**/assets/hierarchical-demo/tileset.json', async (route) => {
    if (!hierarchicalTilesetRequest(
      route.request().url(),
      route.request().resourceType(),
    )) {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.goto(HIERARCHICAL_ASSET_URL);

  const hint = page.locator('[data-role="controls-hint"]');

  await expect(hint).toBeHidden();
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');
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

test('loads a same-origin asset selected by a local preview override', async ({
  page,
}) => {
  await page.goto(
    'http://127.0.0.1:8104/?asset=/assets/hierarchical-demo/tileset.json',
  );

  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  await expect(page.locator('[data-role="stage"]'))
    .toHaveAttribute('aria-busy', 'false');
});

test('prefers a local preview when the root URL is opened', async ({ page }) => {
  const previewRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/assets/local-preview.local.json')) {
      previewRequests.push(request.method());
    }
  });
  await page.unroute('**/assets/local-preview.local.json');
  await page.route(
    '**/assets/local-preview.local.json',
    (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        asset: {
          version: '1.1',
          extras: {
            ice3: {
              assetId: 'local-preview',
              contractVersion: '1.0',
            },
          },
        },
        geometricError: 0,
        root: {
          boundingVolume: {
            box: [15.5, 0, 0.5, 15.5, 0, 0, 0, 0.5, 0, 0, 0, 0.175],
          },
          geometricError: 0,
          refine: 'REPLACE',
          content: {
            uri: 'hierarchical-demo/coarse/group-root.glb',
          },
          extras: {
            ice3: {
              assetId: 'local-preview',
              partitionId: 'local-preview-root',
            },
          },
        },
      }),
    }),
  );

  await page.goto('http://127.0.0.1:8104/');

  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  expect(await page.evaluate(
    () => window.__ice3M1.assetStats().meshCount,
  )).toBeGreaterThan(0);
  expect(previewRequests).toContain('HEAD');
  expect(previewRequests).toContain('GET');
});

test('activates one adaptive generation only after idle', async ({ page }) => {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => {
    failedRequests.push(request.url());
  });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('http://127.0.0.1:8104/?demo=adaptive');
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');

  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.adaptiveStats()),
  ).toMatchObject({
    mode: 'adaptive',
    activeGeneration: 2,
    adaptiveBatchCount: 1,
  });
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.diagnostics().renderer.drawCalls),
  ).toBe(1);
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().renderer.instancingFallbacks,
  )).toBe(0);

  for (let index = 0; index < 12; index += 1) {
    await page.evaluate((offset) => {
      window.__ice3M1.setCameraPose(
        [offset * 0.2, 0.2, 5],
        [0, 0, 0],
      );
    }, index % 2 === 0 ? 1 : -1);
    await page.waitForTimeout(30);
    const stats = await page.evaluate(() => window.__ice3M1.adaptiveStats());
    expect(stats).toMatchObject({
      activeGeneration: 2,
      adaptiveBatchCount: 0,
    });
    expect(stats.candidateGeneration).toBeUndefined();
  }
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.adaptiveStats()),
  ).toMatchObject({
    activeGeneration: 3,
    adaptiveBatchCount: 1,
  });
  await page.evaluate(() => window.__ice3M1.selectOverviewDevice());
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(1);
  const selectionInfo = page.locator('[data-role="selection-info"]');
  await expect(selectionInfo).toBeVisible();
  await expect(page.locator('[data-role="selection-name"]')).not.toBeEmpty();
  await expect(page.locator('[data-role="selection-name"]'))
    .not.toContainText('adaptive-render-batch');
  await expect(page.locator('[data-role="selection-code"]')).toContainText('EQ-');

  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('reuses resident GPU buffers while rotating through covered content', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/?demo=adaptive&adaptive=0');
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');
  expect(await page.evaluate(() => window.__ice3M1.adaptiveStats().mode))
    .toBe('asset');
  const before = await page.evaluate(
    () => window.__ice3M1.diagnostics().renderer,
  );
  expect(before.gpuUploads).toBeGreaterThan(0);
  await page.evaluate(() => {
    const samples: number[] = [];
    Object.assign(window, { __ice3BatchSamples: samples });
    let frame = 0;
    const sample = () => {
      samples.push(window.__ice3M1.diagnostics().renderer.renderedBatches);
      frame += 1;
      if (frame < 120) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');

  await page.mouse.move(stage.width * 0.35, stage.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(
    stage.width * 0.8,
    stage.height * 0.5,
    { steps: 20 },
  );
  await page.mouse.move(
    stage.width * 0.35,
    stage.height * 0.5,
    { steps: 20 },
  );
  await page.mouse.up();
  await page.waitForTimeout(500);

  const after = await page.evaluate(
    () => window.__ice3M1.diagnostics().renderer,
  );
  const samples = await page.evaluate(
    () => (window as Window & { __ice3BatchSamples: number[] })
      .__ice3BatchSamples,
  );
  expect(after.gpuUploads).toBe(before.gpuUploads);
  expect(after.gpuEvictions).toBe(before.gpuEvictions);
  expect(after.gpuBytes).toBeGreaterThan(0);
  expect(Math.min(...samples)).toBeGreaterThan(0);
});

test('shows an accessible loading state until the asset is ready', async ({ page }) => {
  await page.route('**/assets/hierarchical-demo/tileset.json', async (route) => {
    if (!hierarchicalTilesetRequest(
      route.request().url(),
      route.request().resourceType(),
    )) {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.goto(HIERARCHICAL_ASSET_URL);

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

test('shows coarse overview before fine leaf requests finish', async ({ page }) => {
  await page.route('**/hierarchical-demo/parts/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto(HIERARCHICAL_ASSET_URL);

  const progress = page.locator('[data-role="tileset-progress"]');
  await expect(progress).toHaveText(
    /切面 1 · 驻留 1 · 粗模 [1-9]\d* · 细模 0 · 回退 0/,
  );
  await expect(page.locator('[data-role="stage"]')).toHaveAttribute(
    'aria-busy',
    'false',
  );
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');
});

test('keeps coarse coverage when focused fine content fails', async ({ page }) => {
  await page.route('**/hierarchical-demo/parts/**', (route) => (
    route.fulfill({
      status: 500,
      contentType: 'text/plain',
      body: 'unavailable',
    })
  ));
  await page.goto(HIERARCHICAL_ASSET_URL);
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');
  await page.evaluate(() => window.__ice3M1.focusLodBranch());

  await expect(page.locator('[data-role="status"]'))
    .toContainText('部分分区加载失败');
  await expect(page.locator('[data-role="stage"]'))
    .toHaveAttribute('aria-busy', 'false');
  expect(await page.evaluate(
    () => window.__ice3M1.tilesetStats().lod.coarseResident,
  )).toBeGreaterThan(0);
});

test('retains the resident work set while the camera moves', async ({ page }) => {
  await page.goto(HIERARCHICAL_ASSET_URL);
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');
  const initialResident = await page.evaluate(
    () => window.__ice3M1.tilesetStats().resident,
  );

  await page.evaluate(() => window.__ice3M1.setCameraPose([0, 0, 8], [0, 0, 0]));
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.tilesetStats().resident),
  ).toBe(initialResident);

  await page.evaluate(() => window.__ice3M1.setCameraPose(
    [20.5, 0, 2],
    [20.5, 0, 0],
  ));
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.tilesetStats().resident),
  ).toBeGreaterThan(0);
});

test('clears selection when its visible partition is unloaded', async ({ page }) => {
  await page.goto(HIERARCHICAL_ASSET_URL);
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');
  await page.evaluate(() => window.__ice3M1.setCameraPose([0, 0, 8], [0, 0, 0]));
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.tilesetStats().resident),
  ).toBeGreaterThan(0);
  await page.evaluate(() => window.__ice3M1.whenLodIdle());
  const center = await page.evaluate(() => window.__ice3M1.assetCenter());
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');
  await page.mouse.click(stage.x + center.x, stage.y + center.y);
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(1);

  await page.evaluate(() => window.__ice3M1.setCameraPose([12, 0, 8], [12, 0, 0]));
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(0);
  await expect(page.locator('[data-role="selection-info"]')).toBeHidden();
});

test('keeps a visible error state when model loading fails', async ({ page }) => {
  await page.route('**/assets/hierarchical-demo/tileset.json', async (route) => {
    if (!hierarchicalTilesetRequest(
      route.request().url(),
      route.request().resourceType(),
    )) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: 'text/plain',
      body: 'unavailable',
    });
  });
  await page.goto(HIERARCHICAL_ASSET_URL);

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
  await page.route('**/assets/hierarchical-demo/tileset.json', async (route) => {
    if (!hierarchicalTilesetRequest(
      route.request().url(),
      route.request().resourceType(),
    )) {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
  await page.goto(HIERARCHICAL_ASSET_URL);
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

  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');
  const hint = page.locator('[data-role="controls-hint"]');
  await expect(hint).toBeVisible();
  const hintBox = await hint.boundingBox();
  if (!hintBox) throw new Error('Control hint bounds missing');
  expect(hintBox.x).toBeGreaterThanOrEqual(0);
  expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(390);

  const center = await page.evaluate(() => window.__ice3M1.assetCenter());
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');
  await page.mouse.click(stage.x + center.x, stage.y + center.y);
  const info = page.locator('[data-role="selection-info"]');
  await expect(info).toBeVisible();
  const infoBox = await info.boundingBox();
  if (!infoBox) throw new Error('Selection info bounds missing');
  expect(infoBox.x).toBeGreaterThanOrEqual(0);
  expect(infoBox.x + infoBox.width).toBeLessThanOrEqual(390);
});

test('loads and renders the prepared industrial asset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(HIERARCHICAL_ASSET_URL);

  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');
  await expect
    .poll(async () => {
      const pixel = await page.evaluate(
        () => window.__ice3M1.scenePixelAtProjection(),
      );
      return pixel[2] > pixel[0];
    })
    .toBe(true);
  const pixel = await page.evaluate(() => window.__ice3M1.scenePixelAtProjection());
  expect(pixel[2]).toBeGreaterThan(pixel[0]);
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().backend.picking,
  )).toBe(true);
  expect(await page.evaluate(() => window.__ice3M1.assetStats())).toEqual({
    nodeCount: 6,
    maxNodeDepth: 2,
    meshCount: 4,
    primitiveCount: 8,
    triangleCount: 64,
    edgeSegmentCount: 84,
    materialCount: 4,
    selectionGroupCount: 4,
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
  await page.goto(HIERARCHICAL_ASSET_URL);
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');

  await page.getByRole('button', { name: '释放资产' }).click();
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已释放');
  await page.getByRole('button', { name: '释放资产' }).click();
  await expect(page.locator('[data-role="status"]')).toHaveText('资产已释放');
});

test('uses a black background with material contrast', async ({ page }) => {
  await page.goto(HIERARCHICAL_ASSET_URL);
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');
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
  await page.goto(HIERARCHICAL_ASSET_URL);
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');
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

test('selects one equipment unit with a yellow highlight and info panel', async ({ page }) => {
  await page.goto(HIERARCHICAL_ASSET_URL);
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');
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
  const info = page.locator('[data-role="selection-info"]');
  await expect(info).toBeVisible();
  await expect(info).toContainText('演示信息');
  await expect(page.locator('[data-role="selection-name"]')).not.toBeEmpty();
  await expect(page.locator('[data-role="selection-code"]')).toContainText('EQ-');
  await expect(page.locator('[data-role="selection-status"]')).not.toBeEmpty();
  await expect(page.locator('[data-role="selection-type"]')).not.toBeEmpty();
  await expect(page.locator('[data-role="selection-area"]')).not.toBeEmpty();
  expect(await page.evaluate(() => (
    window.__ice3M1.diagnostics().labels.some(
      (label) => label.id === 'selection-label',
    )
  ))).toBe(false);
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-layer="scene"]',
    )!;
    const gl = canvas.getContext('webgl2')!;
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(
      0,
      0,
      canvas.width,
      canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (
        pixels[offset]! > 180
        && pixels[offset + 1]! > 140
        && pixels[offset + 2]! < 120
      ) {
        count += 1;
      }
    }
    return count;
  })).toBeGreaterThan(20);
  const selectedPixel = await page.evaluate(
    () => window.__ice3M1.scenePixelAtProjection(),
  );
  expect(selectedPixel[0] - before[0]).toBeGreaterThanOrEqual(50);
  expect(before[2] - selectedPixel[2]).toBeGreaterThanOrEqual(50);
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().lastPickTimeMs,
  )).toBeGreaterThan(0);
});

test('clears selection on empty click and does not select while dragging', async ({ page }) => {
  await page.goto(HIERARCHICAL_ASSET_URL);
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');
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

  await waitForAssetProjectionToSettle(page);
  const settledCenter = await page.evaluate(
    () => window.__ice3M1.assetCenter(),
  );
  await page.mouse.click(
    stage.x + settledCenter.x,
    stage.y + settledCenter.y,
  );
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(1);
  await page.mouse.click(stage.x + stage.width - 20, stage.y + 20);
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(0);
  await expect(page.locator('[data-role="selection-info"]')).toBeHidden();
});

test('does not select during a two-pointer pinch gesture', async ({ page }) => {
  await page.goto(HIERARCHICAL_ASSET_URL);
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');

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

test('shows coarse coverage and refines the focused branch', async ({ page }) => {
  await page.goto(HIERARCHICAL_ASSET_URL);
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');

  expect(await page.evaluate(
    () => window.__ice3M1.tilesetStats().lod.coarseResident,
  )).toBeGreaterThan(0);
  await page.evaluate(() => window.__ice3M1.focusLodBranch());
  await expect.poll(
    () => page.evaluate(
      () => window.__ice3M1.tilesetStats().lod.fineResident,
    ),
  ).toBeGreaterThan(0);
  await expect(page.locator('[data-role="tileset-progress"]'))
    .toContainText(/细模 [1-9]/);
});

test('keeps selection through a coarse-to-fine transition', async ({ page }) => {
  await page.goto(HIERARCHICAL_ASSET_URL);
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');
  await page.evaluate(() => window.__ice3M1.selectOverviewDevice());

  await page.evaluate(() => window.__ice3M1.focusLodBranch());
  await expect.poll(
    () => page.evaluate(
      () => window.__ice3M1.tilesetStats().lod.fineResident,
    ),
  ).toBeGreaterThan(0);
  await expect(page.locator('[data-role="selection-info"]')).toBeVisible();
  expect(await page.evaluate(() => window.__ice3M1.selectedIds().length))
    .toBe(1);
});

test('keeps coarse coverage while focused fine content is delayed', async ({
  page,
}) => {
  await page.route('**/hierarchical-demo/parts/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.goto(HIERARCHICAL_ASSET_URL);
  await expect(page.locator('[data-role="status"]')).toHaveText('当前视角已就绪');

  await page.evaluate(() => window.__ice3M1.focusLodBranch());
  await expect.poll(
    () => page.evaluate(
      () => window.__ice3M1.tilesetStats().lod.coarseResident,
    ),
  ).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__ice3M1.visibleMeshCount()))
    .toBeGreaterThan(0);
});
