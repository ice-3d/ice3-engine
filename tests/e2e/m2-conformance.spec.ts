import { expect, test } from '@playwright/test';

const cases = [
  { id: 'gltf', name: 'prepared-cube' },
  { id: 'step', name: 'PrimaryTank' },
  { id: 'ifc', name: 'Primary Pump' },
  { id: 'fbx', name: 'Primary Pump' },
  { id: 'usd', name: 'PrimaryPump' },
  { id: 'obj', name: 'PrimaryPump' },
  { id: 'jt', name: 'PrimaryPump' },
] as const;

for (const item of cases) {
  test(`loads and renders ${item.id} Prepared GLB`, async ({ page }) => {
    await page.goto(`http://127.0.0.1:8115/?format=${item.id}`);
    await expect(page.locator('body')).toHaveAttribute('data-state', 'ready', {
      timeout: 20_000,
    });
    await page.waitForFunction(() => Boolean(window.__ice3Conformance));
    const state = await page.evaluate(() => window.__ice3Conformance.state());
    expect(state.format).toBe(item.id);
    expect(state.contractStatus).toBe('active');
    expect(state.names.some((name) => name.includes(item.name))).toBe(true);
    expect(state.stats?.triangleCount ?? 0).toBeGreaterThan(0);
    expect(state.pixelRatio).toBeGreaterThan(0.002);
  });
}

test('switches all formats through the visible controls', async ({ page }) => {
  await page.goto('http://127.0.0.1:8115');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('link', { name: /配套 Toolchain/u }))
    .toHaveAttribute(
      'href',
      'https://github.com/ice-3d/ice3-toolchain',
    );
  for (const item of cases) {
    await page.locator(`.formats [data-format="${item.id}"]`).click();
    await expect(page.locator('body')).toHaveAttribute('data-format', item.id);
    await expect(page.locator('body')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('[data-role="render-check"]'))
      .toHaveAttribute('data-state', 'pass');
  }
});
