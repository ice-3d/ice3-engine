import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const readPackage = (path) =>
  JSON.parse(readFileSync(new URL(`packages/${path}/package.json`, root), 'utf8'));

test('workspace packages exist with the expected dependency direction', () => {
  for (const name of ['core', 'assets', 'renderer', 'runtime', 'ice3']) {
    assert.equal(existsSync(new URL(`packages/${name}/package.json`, root)), true);
  }

  assert.deepEqual(readPackage('core').dependencies ?? {}, {});
  assert.deepEqual(readPackage('assets').dependencies, { '@ice3/core': '0.0.0' });
  assert.deepEqual(readPackage('renderer').dependencies, { '@ice3/core': '0.0.0' });
  assert.deepEqual(readPackage('runtime').dependencies, {
    '@ice3/assets': '0.0.0',
    '@ice3/core': '0.0.0',
    '@ice3/renderer': '0.0.0',
  });
  assert.deepEqual(readPackage('ice3').dependencies, {
    '@ice3/assets': '0.0.0',
    '@ice3/core': '0.0.0',
    '@ice3/renderer': '0.0.0',
    '@ice3/runtime': '0.0.0',
  });
});
