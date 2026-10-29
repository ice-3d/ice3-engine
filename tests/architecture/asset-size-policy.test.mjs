import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const assetPattern = /\.(?:glb|gltf|bin)$/i;
const monolithicAssetPattern =
  /^examples\/m1\/assets\/wastewater-plant\/(?:source|prepared)\//;
const maximumAssetBytes = 50 * 1024 * 1024;

test('tracks only bounded runtime 3D assets', () => {
  const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);

  const violations = trackedFiles
    .filter((file) => monolithicAssetPattern.test(file))
    .map((file) => `${file}: monolithic asset path must remain ignored`);

  for (const file of trackedFiles.filter((candidate) => assetPattern.test(candidate))) {
    const bytes = statSync(`${repositoryRoot}/${file}`).size;
    if (bytes > maximumAssetBytes) {
      violations.push(`${file}: ${bytes} bytes exceeds ${maximumAssetBytes}`);
    }
  }

  assert.deepEqual(violations, []);
});
