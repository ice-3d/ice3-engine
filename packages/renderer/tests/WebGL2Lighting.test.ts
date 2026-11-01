import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { directionalLightingShade } from '../src/WebGL2Program.js';

test('sunny lighting keeps upward faces bright and shadowed faces readable', () => {
  const top = directionalLightingShade([0, 1, 0]);
  const bottom = directionalLightingShade([0, -1, 0]);

  expect(top).toBeGreaterThan(1.25);
  expect(bottom).toBeGreaterThanOrEqual(0.84);
  expect(top - bottom).toBeGreaterThan(0.35);
});
