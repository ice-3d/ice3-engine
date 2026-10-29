import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageRoot = join(root, 'release', 'ice3');
const artifacts = join(root, 'release', 'artifacts');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed:\n${result.stdout}${result.stderr}`,
    );
  }
  return result.stdout;
}

await mkdir(artifacts, { recursive: true });
const packed = JSON.parse(run(
  'npm',
  ['pack', packageRoot, '--json', '--pack-destination', artifacts],
  root,
));
const tarball = join(artifacts, packed[0].filename);
const files = packed[0].files.map((entry) => entry.path);
if (
  !files.includes('dist/index.js')
  || !files.includes('dist/index.d.ts')
  || !files.some((path) => path.startsWith('dist/_types/'))
) {
  throw new Error(`ICE3_RELEASE_CONTENT_INVALID: ${files.join(', ')}`);
}

const consumer = await mkdtemp(join(tmpdir(), 'ice3-engine-consumer-'));
try {
  await writeFile(
    join(consumer, 'package.json'),
    '{"private":true,"type":"module"}\n',
  );
  run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball],
    consumer,
  );
  run(process.execPath, [
    '--input-type=module',
    '--eval',
    "import { ICE3 } from 'ice3'; if (typeof ICE3 !== 'function') process.exit(1);",
  ], consumer);
  await writeFile(
    join(consumer, 'index.ts'),
    "import { ICE3, ICEScene } from 'ice3';\nconst engine: typeof ICE3 = ICE3;\nconst scene: ICEScene | undefined = undefined;\nvoid engine; void scene;\n",
  );
  await writeFile(
    join(consumer, 'tsconfig.json'),
    `${JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        target: 'ES2022',
      },
      include: ['index.ts'],
    }, null, 2)}\n`,
  );
  run(
    join(root, 'node_modules', '.bin', 'tsc'),
    ['--project', 'tsconfig.json'],
    consumer,
  );
  const installed = JSON.parse(await readFile(
    join(consumer, 'node_modules', 'ice3', 'package.json'),
    'utf8',
  ));
  if (installed.dependencies || installed.private) {
    throw new Error('ICE3_RELEASE_DEPENDENCIES_INVALID');
  }
  console.info(`ICE3_RELEASE_OK: ${packed[0].filename}`);
} finally {
  await rm(consumer, { recursive: true, force: true });
}
