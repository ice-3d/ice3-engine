import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import { resolveShadowMapSize } from '../src/WebGL2ShadowMap.js';

test('uses the highest safe power-of-two shadow map up to 4096', () => {
  expect(resolveShadowMapSize(16_384)).toBe(4_096);
  expect(resolveShadowMapSize(4_096)).toBe(4_096);
  expect(resolveShadowMapSize(3_000)).toBe(2_048);
  expect(resolveShadowMapSize(2_048)).toBe(2_048);
  expect(resolveShadowMapSize(1_500)).toBe(1_024);
});
