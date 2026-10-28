import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const filters = process.argv.slice(2).map((value) => resolve(value));
const files = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (path !== join(root, 'tests', 'e2e')) {
        await collect(path);
      }
    } else if (
      entry.name.endsWith('.test.ts')
      && (
        filters.length === 0
        || filters.some((filter) => (
          path === filter
          || path.startsWith(`${filter}/`)
        ))
      )
    ) {
      files.push(path);
    }
  }
}

await collect(join(root, 'packages'));
await collect(join(root, 'tests'));
files.sort();

const result = spawnSync(process.execPath, [
  '--import',
  'tsx',
  '--import',
  join(root, 'tests', 'setup-dom.ts'),
  '--test',
  ...files.map((file) => relative(root, file)),
], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
