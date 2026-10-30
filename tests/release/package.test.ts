import { expect } from '#test-expect';
import { test } from 'node:test';
import {
  createPublicPackageManifest,
  rewriteDeclarationImports,
} from '../../scripts/build-release-package.mjs';

test('publishes the Engine facade as one dependency-free package', () => {
  const manifest = createPublicPackageManifest();

  expect(manifest.name).toBe('ice3');
  expect(manifest.version).toBe('0.2.0');
  expect(manifest.private).toBeUndefined();
  expect(manifest.dependencies).toBeUndefined();
  expect(manifest.exports).toEqual({
    '.': {
      types: './dist/index.d.ts',
      import: './dist/index.js',
    },
  });
});

test('publishes WebGPU renderer API in ice3 0.2.0', () => {
  const manifest = createPublicPackageManifest();
  expect(manifest.keywords).toContain('webgpu');
});

test('rewrites private declaration imports into package-relative paths', () => {
  const rewritten = rewriteDeclarationImports(
    "import type { ICEGeometry } from '@ice3/core';\n",
    '/tmp/release/ice3/dist/_types/runtime/example.d.ts',
    '/tmp/release/ice3/dist',
  );

  expect(rewritten).toBe(
    "import type { ICEGeometry } from '../core/index.js';\n",
  );
});
