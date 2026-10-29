import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createBenchmarkReport, reportToMarkdown } from './report.ts';

const root = resolve(new URL('..', import.meta.url).pathname);
const outputRoot = join(root, 'output', 'benchmarks');
const allScenarios = [
  'unique-meshes',
  'instanced-grid',
  'static-batches',
  'selection',
  'picking',
  'instanced-50k',
  'culling-20k',
  'wastewater-mixed',
  'wastewater-1x',
  'wastewater-5x',
  'wastewater-20x',
];
const args = process.argv.slice(2);
const headless = args.includes('--headless');
const warmup = readNumberOption(args, '--warmup', 60);
const frames = readNumberOption(args, '--frames', 300);
const repetitions = readNumberOption(args, '--repetitions', 5);
const forceStorage = args.includes('--storage');
const forceGpuDriven = args.includes('--gpu-driven');
const scenarioFilter = readStringOption(args, '--scenarios')
  ?.split(',')
  .filter(Boolean);
const scenarios = scenarioFilter
  ? allScenarios.filter((scenario) => scenarioFilter.includes(scenario))
  : allScenarios;
if (scenarios.length === 0) {
  throw new Error('ICE3_BENCHMARK_INVALID: no scenarios selected');
}

runCommand('npm', ['run', 'build']);
runCommand(join(root, 'node_modules', '.bin', 'webpack'), [
  '--config',
  join(root, 'benchmarks', 'webpack.config.cjs'),
]);

const server = createBenchmarkServer();
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
if (!address || typeof address === 'string') {
  throw new Error('ICE3_BENCHMARK_SERVER_FAILED');
}

let browser;
let page;
let completed = false;
try {
  browser = await chromium.launch({
    headless,
    args: ['--enable-unsafe-webgpu'],
  });
  page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(180_000);
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  await page.goto(baseUrl);
  await page.waitForFunction(() => Boolean(window.__ice3Benchmark));
  const environment = await page.evaluate(async () => {
    let adapter = 'unavailable';
    if (navigator.gpu) {
      const value = await navigator.gpu.requestAdapter();
      const info = value?.info;
      adapter = info
        ? [info.vendor, info.architecture, info.device]
            .filter(Boolean)
            .join(' / ')
        : 'adapter available';
    }
    return {
      browser: navigator.userAgent,
      platform: navigator.platform,
      adapter,
    };
  });
  const rawRuns = [];
  for (let iteration = 0; iteration < repetitions; iteration += 1) {
    const order = iteration % 2 === 0
      ? ['webgl2', 'webgpu']
      : ['webgpu', 'webgl2'];
    for (const scenario of scenarios) {
      for (const backend of order) {
        process.stderr.write(
          `benchmark ${iteration + 1}/${repetitions} ${backend}${forceGpuDriven ? ':gpu-driven' : forceStorage ? ':storage' : ''} ${scenario}\n`,
        );
        await page.goto(baseUrl);
        await page.waitForFunction(() => Boolean(window.__ice3Benchmark));
        const result = await page.evaluate(async (request) => (
          window.__ice3Benchmark.run(request)
        ), {
          backend,
          scenario,
          warmup,
          frames,
          forceStorage,
          forceGpuDriven,
        });
        rawRuns.push({ iteration, ...result });
      }
    }
  }
  const grouped = [];
  for (const scenario of scenarios) {
    for (const backend of ['webgl2', 'webgpu']) {
      const runs = rawRuns.filter(
        (run) => run.scenario === scenario && run.backend === backend,
      );
      if (runs.length === 0) continue;
      const gpuRuns = runs.filter(
        (run) => run.gpuFrameMs && run.gpuFrameMs.length > 0,
      );
      grouped.push({
        backend,
        scenario,
        warmupFrames: warmup,
        measuredFrames: frames * runs.length,
        initializationMs: median(runs.map((run) => run.initializationMs)),
        samples: {
          cpuFrameMs: runs.flatMap((run) => run.cpuFrameMs),
          cpuStages: {
            collectMs: runs.flatMap((run) => run.cpuStages.collectMs),
            prepareAndUploadMs: runs.flatMap(
              (run) => run.cpuStages.prepareAndUploadMs,
            ),
            encodeMs: runs.flatMap((run) => run.cpuStages.encodeMs),
            submitMs: runs.flatMap((run) => run.cpuStages.submitMs),
          },
          gpuFrameMs: gpuRuns.length === 0
            ? null
            : gpuRuns.flatMap((run) => run.gpuFrameMs),
          pickMs: runs.flatMap((run) => run.pickMs),
        },
        stats: runs.at(-1).stats,
        optimization: runs.at(-1).optimization,
        gpuFrameTimeUnavailableReason: gpuRuns.length === 0
          ? runs.find((run) => run.gpuFrameTimeUnavailableReason)
            ?.gpuFrameTimeUnavailableReason
          : undefined,
      });
    }
  }
  const report = createBenchmarkReport({
    environment,
    runs: grouped,
  });
  await mkdir(outputRoot, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = join(outputRoot, `${stamp}.json`);
  const markdownPath = join(outputRoot, `${stamp}.md`);
  await writeFile(
    jsonPath,
    `${JSON.stringify({ report, runs: rawRuns }, null, 2)}\n`,
  );
  await writeFile(markdownPath, reportToMarkdown(report));
  console.log(reportToMarkdown(report));
  console.log(`JSON: ${jsonPath}`);
  console.log(`Markdown: ${markdownPath}`);
  completed = true;
} finally {
  if (page) {
    await raceWithTimeout(
      page.goto('about:blank'),
      5_000,
    ).catch(() => undefined);
  }
  server.closeAllConnections();
  await raceWithTimeout(
    new Promise((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error) rejectClose(error);
        else resolveClose();
      });
    }),
    2_000,
  ).catch(() => undefined);
  await raceWithTimeout(browser?.close(), 5_000).catch(() => undefined);
  if (completed) process.exit(0);
}

function createBenchmarkServer() {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      const relative = pathname === '/'
        ? 'index.html'
        : pathname.slice(1);
      const filePath = pathname.startsWith('/assets/')
        ? join(root, 'examples', 'm1', relative)
        : pathname === '/main.js'
          ? join(root, 'dist-benchmark', 'main.js')
          : join(root, 'benchmarks', 'web', relative);
      const normalized = normalize(filePath);
      const permittedRoot = pathname.startsWith('/assets/')
        ? join(root, 'examples', 'm1', 'assets')
        : pathname === '/main.js'
          ? join(root, 'dist-benchmark')
          : join(root, 'benchmarks', 'web');
      if (!normalized.startsWith(permittedRoot)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const body = await readFile(normalized);
      response.writeHead(200, {
        'content-type': contentType(normalized),
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
}

function contentType(path) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.glb': 'model/gltf-binary',
  }[extname(path)] ?? 'application/octet-stream';
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}`);
  }
}

function readNumberOption(values, name, fallback) {
  const index = values.indexOf(name);
  const parsed = index >= 0 ? Number(values[index + 1]) : fallback;
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`ICE3_BENCHMARK_INVALID: ${name} must be positive`);
  }
  return parsed;
}

function readStringOption(values, name) {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function raceWithTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('ICE3_BENCHMARK_CLEANUP_TIMEOUT')), timeoutMs);
    }),
  ]);
}
