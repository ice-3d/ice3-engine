import { expect, test } from '@playwright/test';

test('auto resolves to the stable WebGL2 renderer', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/?renderer=auto');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  const selection = await page.evaluate(
    () => window.__ice3M1.diagnostics().rendererSelection,
  );
  expect(selection).toMatchObject({
    requested: 'auto',
    selected: 'webgl2',
    fallback: false,
    experimental: false,
  });
});

test('default initialization uses WebGL2', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().rendererSelection,
  )).toMatchObject({
    requested: 'webgl2',
    selected: 'webgl2',
    fallback: false,
    experimental: false,
  });
});

test('forced WebGL2 remains functional', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/?renderer=webgl2');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().backend.backend,
  )).toBe('webgl2');
});

test('auto stays on WebGL2 even when WebGPU is available', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: { requestAdapter: async () => ({}) },
    });
  });
  await page.goto('http://127.0.0.1:8104/?renderer=auto');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().rendererSelection,
  )).toMatchObject({
    requested: 'auto',
    selected: 'webgl2',
    fallback: false,
    experimental: false,
  });
});

test('explicit WebGPU is reported as experimental', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'WebGPU smoke runs in Chromium');
  await page.goto('http://127.0.0.1:8104/');
  const supported = await page.evaluate(async () => {
    if (!navigator.gpu) return false;
    return Boolean(await navigator.gpu.requestAdapter());
  });
  test.skip(!supported, 'WebGPU adapter is unavailable');

  await page.goto('http://127.0.0.1:8104/?renderer=webgpu');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().rendererSelection,
  )).toMatchObject({
    requested: 'webgpu',
    selected: 'webgpu',
    fallback: false,
    experimental: true,
  });
});

test('selected renderer picks the projected equipment center', async ({ page }) => {
  await page.goto(
    'http://127.0.0.1:8104/?asset=/assets/hierarchical-demo/tileset.json',
  );
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  const center = await page.evaluate(() => window.__ice3M1.assetCenter());
  const picked = await page.evaluate(
    (point) => window.__ice3M1.pickSelectionId(point),
    center,
  );
  expect(picked).toBeTruthy();
  const stage = await page.locator('[data-role="stage"]').boundingBox();
  if (!stage) throw new Error('Stage bounds missing');
  await page.mouse.click(stage.x + center.x, stage.y + center.y);
  await expect.poll(
    () => page.evaluate(() => window.__ice3M1.selectedIds().length),
  ).toBe(1);
});
