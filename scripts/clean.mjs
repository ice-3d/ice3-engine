import { readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const packagesDirectory = resolve('packages');
for (const entry of await readdir(packagesDirectory, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  await rm(join(packagesDirectory, entry.name, 'dist'), {
    recursive: true,
    force: true,
  });
}
