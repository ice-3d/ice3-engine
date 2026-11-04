import { test } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import {
  specularGain,
  specularReflectance,
  specularShininess,
} from '../src/WebGL2Program.js';

test('smoother surfaces get a tighter highlight', () => {
  const mirror = specularShininess(0.05);
  const satin = specularShininess(0.4);
  const rough = specularShininess(1);
  expect(mirror).toBeGreaterThan(150);
  expect(mirror).toBeGreaterThan(satin);
  expect(satin).toBeGreaterThan(rough);
  expect(rough).toBeGreaterThanOrEqual(8);
});

test('rougher surfaces reflect less light back', () => {
  expect(specularGain(0.05)).toBeGreaterThan(0.8);
  expect(specularGain(0.05)).toBeGreaterThan(specularGain(0.5));
  expect(specularGain(0.5)).toBeGreaterThan(specularGain(1));
  expect(specularGain(1)).toBeGreaterThan(0);
});

test('metals tint their highlight, dielectrics stay neutral', () => {
  const dielectric = specularReflectance(0, [0.9, 0.3, 0.1]);
  expect(dielectric[0]).toBeCloseTo(0.04, 5);
  expect(dielectric[1]).toBeCloseTo(0.04, 5);
  const metal = specularReflectance(1, [0.9, 0.3, 0.1]);
  expect(metal[0]).toBeCloseTo(0.9, 5);
  expect(metal[1]).toBeCloseTo(0.3, 5);
  const blend = specularReflectance(0.5, [0.9, 0.3, 0.1]);
  expect(blend[0]).toBeCloseTo(0.47, 5);
});
