import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  AO_MAX_SCREEN_RADIUS_PX,
  ssaoPixelRadius,
  ssaoViewFadeWeight,
} from '../src/WebGL2Program.js';

test('SSAO fades and bounds its footprint at grazing angles', () => {
  expect(ssaoPixelRadius(2.5, 25, 0.42, 900)).toBeLessThanOrEqual(
    AO_MAX_SCREEN_RADIUS_PX,
  );
  expect(ssaoViewFadeWeight(0.05, 1)).toBe(0);
  expect(ssaoViewFadeWeight(0.3, 1)).toBeLessThan(0.5);
  expect(ssaoViewFadeWeight(0.3, 0)).toBe(1);
  expect(ssaoViewFadeWeight(0.8, 1)).toBe(1);
});
