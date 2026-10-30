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
  await page.evaluate(
    () => window.__ice3M1.setCameraPose([285, 150, 220], [135, 0, 40]),
  );
  await page.evaluate(() => window.__ice3M1.whenLodIdle());
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
    () => window.__ice3M1.setCameraPose([142, 18, 56], [142, 3.7, 36]),
  );
  await page.evaluate(() => window.__ice3M1.whenLodIdle());
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.tilesetStats().lod.fineResident),
  ).toBeGreaterThan(0);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const center = await page.evaluate(
    () => window.__ice3M1.projectWorldPoint([142, 3.7, 36]),
  );
  const overlay = page.locator('canvas[data-layer="overlay"]');
  await overlay.click({ position: { x: center.x, y: center.y } });
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds()[0]),
  ).toBe('ice3-virtual-wwtp/equipment/SC-101');
  await expect(page.locator('[data-role="selection-info"]')).toBeVisible();
  await expect(page.locator('[data-role="selection-name"]')).toHaveText('二沉池 A');
  const metadata = await page.evaluate(() => window.__ice3M1.equipmentMetadata(
    'ice3-virtual-wwtp/equipment/SC-101',
  ));
  expect(metadata).toMatchObject({
    equipmentTag: 'SC-101',
    area: 'SecondaryTreatmentArea',
    processStage: 'secondary',
  });
  expect(metadata?.connections.length).toBeGreaterThan(0);
  await expect(page.locator('[data-role="selection-code"]')).toHaveText('SC-101');
  await expect(page.locator('[data-role="selection-type"]'))
    .toHaveText('二沉与污泥回流');
  await expect(page.locator('[data-role="selection-area"]')).toHaveText('二沉与回流区');
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.yellowPixelCount()),
  ).toBeGreaterThan(0);
  expect(await page.evaluate(
    (point) => window.__ice3M1.pickSelectionId(point),
    center,
  )).toBe('ice3-virtual-wwtp/equipment/SC-101');
});
