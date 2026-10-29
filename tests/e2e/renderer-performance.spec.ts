import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route(
    '**/assets/local-preview.local.json',
    (route) => route.fulfill({ status: 404 }),
  );
});

test('keeps the wastewater scene visible with the selected renderer', async ({
  page,
}) => {
  await openWastewaterOverview(page);
  const canvasSize = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas[data-layer="scene"]',
    );
    return canvas ? [canvas.width, canvas.height] : [0, 0];
  });
  expect(canvasSize[0]).toBeGreaterThan(0);
  expect(canvasSize[1]).toBeGreaterThan(0);
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().renderer.renderedBatches,
  )).toBeGreaterThan(0);
});

test('keeps scene pixels after resize and exact selection after picking', async ({
  page,
}) => {
  await openWastewaterOverview(page);
  const before = await page.evaluate(
    () => window.__ice3M1.scenePixelAtProjection(),
  );
  expect(before[3]).toBeGreaterThan(0);

  await page.setViewportSize({ width: 960, height: 640 });
  await expect.poll(() => page.evaluate(
    () => window.__ice3M1.scenePixelAtProjection(),
  )).not.toEqual([0, 0, 0, 0]);

  await page.evaluate(
    () => window.__ice3M1.setCameraPose([142, 18, 56], [142, 3.7, 36]),
  );
  await page.evaluate(() => window.__ice3M1.whenLodIdle());
  const point = await page.evaluate(
    () => window.__ice3M1.projectWorldPoint([142, 3.7, 36]),
  );
  expect(await page.evaluate(
    (value) => window.__ice3M1.pickSelectionId(value),
    point,
  )).toBe('ice3-virtual-wwtp/equipment/SC-101');
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('stage bounds are unavailable');
  await page.mouse.click(stage.x + point.x, stage.y + point.y);
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.yellowPixelCount()),
  ).toBeGreaterThan(0);
});

async function openWastewaterOverview(page: Page): Promise<void> {
  await page.goto('http://127.0.0.1:8104/?renderer=auto');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  await page.evaluate(
    () => window.__ice3M1.setCameraPose([285, 150, 220], [135, 0, 40]),
  );
  await page.evaluate(() => window.__ice3M1.whenLodIdle());
}
