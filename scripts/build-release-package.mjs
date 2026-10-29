import { build } from 'esbuild';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  dirname,
  join,
  relative,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageRoot = join(root, 'packages', 'ice3');
const releaseRoot = join(root, 'release');
const outputRoot = join(releaseRoot, 'ice3');
const outputDist = join(outputRoot, 'dist');
const internalPackages = ['core', 'assets', 'renderer', 'runtime'];

export function createPublicPackageManifest() {
  return {
    name: 'ice3',
    version: '0.1.1',
    description: 'Industrial-first browser 3D runtime',
    license: 'MIT',
    type: 'module',
    sideEffects: false,
    exports: {
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
      },
    },
    files: [
      'dist/index.js',
      'dist/index.js.map',
      'dist/index.d.ts',
      'dist/_types/**/*.d.ts',
    ],
    repository: {
      type: 'git',
      url: 'git+https://github.com/ice-3d/ice3-engine.git',
      directory: 'packages/ice3',
    },
    homepage: 'https://github.com/ice-3d/ice3-engine#readme',
    bugs: {
      url: 'https://github.com/ice-3d/ice3-engine/issues',
    },
    keywords: [
      'ice3',
      '3d',
      'industrial',
      'webgl2',
      'digital-twin',
      'tileset',
    ],
    publishConfig: {
      access: 'public',
    },
  };
}

export function rewriteDeclarationImports(source, filePath, distRoot) {
  return source.replace(
    /(['"])@ice3\/(core|assets|renderer|runtime)\1/g,
    (_match, quote, packageName) => {
      const target = join(distRoot, '_types', packageName, 'index.d.ts');
      let path = relative(dirname(filePath), target)
        .split(sep)
        .join('/')
        .replace(/\.d\.ts$/u, '.js');
      if (!path.startsWith('.')) path = `./${path}`;
      return `${quote}${path}${quote}`;
    },
  );
}

async function removeJavaScriptFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await removeJavaScriptFiles(path);
    } else if (!entry.name.endsWith('.d.ts')) {
      await rm(path);
    }
  }
}

async function rewriteDeclarations(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteDeclarations(path);
    } else if (entry.name.endsWith('.d.ts')) {
      const source = await readFile(path, 'utf8');
      await writeFile(
        path,
        rewriteDeclarationImports(source, path, outputDist),
      );
    }
  }
}

export async function buildReleasePackage() {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(join(outputDist, '_types'), { recursive: true });
  await cp(
    join(packageRoot, 'README.md'),
    join(outputRoot, 'README.md'),
  );
  await cp(
    join(packageRoot, 'LICENSE'),
    join(outputRoot, 'LICENSE'),
  );

  for (const name of internalPackages) {
    const destination = join(outputDist, '_types', name);
    await cp(
      join(root, 'packages', name, 'dist'),
      destination,
      { recursive: true },
    );
    await removeJavaScriptFiles(destination);
  }
  await cp(
    join(packageRoot, 'dist', 'index.d.ts'),
    join(outputDist, 'index.d.ts'),
  );
  await rewriteDeclarations(outputDist);

  await build({
    entryPoints: [join(packageRoot, 'src', 'index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile: join(outputDist, 'index.js'),
    sourcemap: true,
    legalComments: 'eof',
  });

  await writeFile(
    join(outputRoot, 'package.json'),
    `${JSON.stringify(createPublicPackageManifest(), null, 2)}\n`,
  );
}

const directEntry = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;
if (directEntry) {
  await buildReleasePackage();
}
