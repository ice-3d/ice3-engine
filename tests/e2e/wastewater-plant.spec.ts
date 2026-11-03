import { expect, test } from '@playwright/test';

test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  await page.route(
    '**/assets/local-preview.local.json',
    (route) => route.fulfill({ status: 404 }),
  );
});

test('loads the packaged hierarchical demo from the root URL', async ({ page }) => {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  const assetRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => {
    if (!request.url().includes('/assets/local-preview.local.json')) {
      failedRequests.push(request.url());
    }
  });
  page.on('request', (request) => {
    if (request.url().includes('/assets/hierarchical-demo/')) {
      assetRequests.push(request.url());
    }
  });

  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  await expect(page.locator('[data-role="loading"]'))
    .toHaveAttribute('data-state', 'ready');
  await page.evaluate(
    () => window.__ice3M1.setCameraPose([20, 10, 20], [15, 0, 0]),
  );
  await page.evaluate(() => window.__ice3M1.whenLodIdle());
  const renderedBatches = await page.evaluate(
    () => window.__ice3M1.diagnostics().renderer.renderedMeshes,
  );

  expect(renderedBatches).toBeGreaterThan(0);
  expect(assetRequests.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('selects a model entity from the default scene', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');

  await page.evaluate(() => window.__ice3M1.whenLodIdle());
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const center = await page.evaluate(() => window.__ice3M1.assetCenter());
  const overlay = page.locator('canvas[data-layer="overlay"]');
  await overlay.click({ position: { x: center.x, y: center.y } });
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(1);
  await expect(page.locator('[data-role="selection-info"]')).toBeVisible();
  await expect(page.locator('[data-role="selection-name"]')).not.toBeEmpty();
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.yellowPixelCount()),
  ).toBeGreaterThan(0);
});
