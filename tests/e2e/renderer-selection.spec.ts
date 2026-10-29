import { expect, test } from '@playwright/test';

test('auto selects the strongest available renderer', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/?renderer=auto');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  const selection = await page.evaluate(
    () => window.__ice3M1.diagnostics().rendererSelection,
  );
  expect(['webgpu', 'webgl2']).toContain(selection.selected);
  if (selection.selected === 'webgl2') {
    expect(selection.fallback).toBe(true);
    expect(selection.fallbackReason).toBeTruthy();
  }
  expect(selection.requested).toBe('auto');
});

test('forced WebGL2 remains functional', async ({ page }) => {
  await page.goto('http://127.0.0.1:8104/?renderer=webgl2');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().backend.backend,
  )).toBe('webgl2');
});

test('auto falls back when navigator.gpu is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto('http://127.0.0.1:8104/?renderer=auto');
  await expect(page.locator('[data-role="status"]'))
    .toHaveText('当前视角已就绪');
  expect(await page.evaluate(
    () => window.__ice3M1.diagnostics().rendererSelection,
  )).toMatchObject({
    selected: 'webgl2',
    fallback: true,
    fallbackReason: 'api-unavailable',
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
