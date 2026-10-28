import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(
    '**/assets/local-preview.local.json',
    (route) => route.fulfill({ status: 404 }),
  );
});

test('loads the virtual wastewater plant from the root URL', async ({ page }) => {
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
    if (request.url().includes('/assets/wastewater-plant/')) {
      assetRequests.push(request.url());
    }
  });

  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  const equipmentIds = await page.evaluate(
    () => window.__ice3M1.equipmentSelectionIds(),
  );
  const renderedBatches = await page.evaluate(
    () => window.__ice3M1.diagnostics().renderer.renderedBatches,
  );

  expect(equipmentIds.length).toBeGreaterThanOrEqual(60);
  expect(renderedBatches).toBeGreaterThan(0);
  expect(assetRequests.length).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('selects a virtual wastewater device from the default scene', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');

  await page.evaluate(
    () => window.__ice3M1.setCameraPose([140, 24, 60], [140, 1, 36]),
  );
  await page.evaluate(() => window.__ice3M1.whenLodIdle());
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  const center = await page.evaluate(
    () => window.__ice3M1.projectWorldPoint([140, 0.25, 36]),
  );
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');
  await page.mouse.click(stage.x + center.x, stage.y + center.y);

  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(1);
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds()[0]),
  ).toMatch(/^ice3-virtual-wwtp\/equipment\//);
  await expect(page.locator('[data-role="selection-info"]')).toBeVisible();
  await expect(page.locator('[data-role="selection-name"]')).not.toBeEmpty();
});
