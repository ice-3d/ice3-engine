import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(
    '**/assets/local-preview.local.json',
    (route) => route.fulfill({ status: 404 }),
  );
});

test('loads the virtual wastewater plant from the root URL', async ({ page }) => {
  const errors: string[] = [];
  const assetRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
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
});

test('selects a virtual wastewater device and shows its details', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');

  const selectedId = await page.evaluate(
    () => window.__ice3M1.selectWastewaterEquipment(),
  );

  expect(selectedId).toMatch(/ice3-virtual-wwtp\/equipment\//);
  await expect(page.locator('[data-role="selection-info"]')).toBeVisible();
  await expect(page.locator('[data-role="selection-name"]')).not.toBeEmpty();
});
