import { expect } from '#test-expect';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  createPublicPackageManifest,
  rewriteDeclarationImports,
} from '../../scripts/build-release-package.mjs';

test('publishes the Engine facade as one dependency-free package', () => {
  const manifest = createPublicPackageManifest();

  expect(manifest.name).toBe('ice3');
  // 发布清单里的版本必须和公开包的 package.json 一致，这里不写死数字。
  const declared = JSON.parse(
    readFileSync(new URL('../../packages/ice3/package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  expect(manifest.version).toBe(declared.version);
  expect(manifest.private).toBeUndefined();
  expect(manifest.dependencies).toBeUndefined();
  expect(manifest.exports).toEqual({
    '.': {
      types: './dist/index.d.ts',
      import: './dist/index.js',
    },
  });
});

test('publishes WebGPU renderer API in the public facade', () => {
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
