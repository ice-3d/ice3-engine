import { readFileSync } from 'node:fs';
import { FakeRendererBackend } from '@ice3/renderer';
import { it } from 'node:test';
import { expect } from '../../../tests/assertions.ts';
import * as mockApi from '../../../tests/test-mocks.ts';
import {
  ICE3,
  ICEMesh,
  type ICENode,
  ICEPerspectiveCamera,
} from '../src/index';
import { ICETilesetLoader } from '../src/asset/ICETilesetLoader';

const fixture = (path: string) => readFileSync(
  `tests/fixtures/spatial-demo/${path}`,
);
const camera = () => new ICEPerspectiveCamera({
  id: 'camera',
  fov: 45,
  near: 0.1,
  far: 1000,
  position: [0, 0, 20],
  target: [0, 0, 0],
});
const overviewCamera = () => new ICEPerspectiveCamera({
  id: 'camera-overview',
  fov: 60,
  near: 0.1,
  far: 1000,
  position: [15, 0, 50],
  target: [15, 0, 0],
});
const multiContentTileset = (): string => JSON.stringify({
  asset: {
    version: '1.1',
    extras: {
      ice3: {
        assetId: 'multi-content-demo',
        contractVersion: '1.0',
      },
    },
  },
  geometricError: 10,
  root: {
    boundingVolume: {
      box: [15.5, 0, 0.5, 15.5, 0, 0, 0, 0, 0.5, 0, 0, 0],
    },
    geometricError: 0,
    refine: 'REPLACE',
    contents: [
      { uri: 'parts/part-000.glb' },
      { uri: 'parts/part-001.glb' },
    ],
  },
});

it('opens before all tiles finish and commits completed tiles progressively', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const orbitCamera = camera();
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    const name = url.split('/').at(-1)!;
    if (name !== 'part-000.glb') {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return new Response(fixture(`parts/${name}`));
  });
  const loader = new ICETilesetLoader(engine, { fetch, camera: orbitCamera });
  const tileset = await loader.open(
    'https://example.test/spatial-demo/tileset.json',
  );

  expect(Object.isFrozen(tileset.stats)).toBe(true);
  expect(tileset.stats.loaded).toBe(0);
  await tileset.whenReady();
  expect(tileset.stats.loaded).toBe(1);
  expect(tileset.stats.loaded).toBeLessThan(tileset.stats.total);
  await tileset.whenIdle();
  expect(tileset.stats.loaded).toBeGreaterThanOrEqual(tileset.stats.visible);
  expect(tileset.stats.loaded).toBeLessThan(tileset.stats.total);
  expect(tileset.scene.children.length).toBeGreaterThan(0);
  tileset.dispose();
  expect(tileset.scene.children).toHaveLength(0);
});

it('keeps resident Tile geometry on the GPU until the Tile unloads', async () => {
  const backend = new FakeRendererBackend();
  const prepared = new Set<object>();
  const released = new Set<object>();
  Object.assign(backend, {
    prepareBatchGeometry: (geometry: object) => {
      prepared.add(geometry);
    },
    releaseBatchGeometry: (geometry: object) => {
      released.add(geometry);
    },
  });
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(new ICE3({ backend }), {
    fetch,
    camera: camera(),
  }).open('https://example.test/spatial-demo/tileset.json');
  await tileset.whenReady();

  expect(prepared.size).toBeGreaterThan(0);
  expect(released.size).toBe(0);

  tileset.dispose();
  expect(released).toEqual(prepared);
});

it('keeps the current resident coverage during camera motion', async () => {
  const backend = new FakeRendererBackend();
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(new ICE3({ backend }), {
    fetch,
    camera: overviewCamera(),
  }).open('https://example.test/spatial-demo/tileset.json');
  await tileset.whenReady();
  await tileset.whenIdle();
  const internals = tileset as unknown as {
    resident: Map<string, { container: ICENode }>;
    motionFallbackId: string | undefined;
    enterCameraMotion(): void;
  };
  const ids = [...internals.resident.keys()];
  expect(ids.length).toBeGreaterThan(1);
  for (const resident of internals.resident.values()) {
    resident.container.visible = true;
  }
  internals.motionFallbackId = ids[0];

  internals.enterCameraMotion();

  expect(
    [...internals.resident.values()]
      .filter((resident) => resident.container.visible),
  ).toHaveLength(ids.length);
  tileset.dispose();
});

it('keeps prior visible coverage inside the unload halo', async () => {
  const backend = new FakeRendererBackend();
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(new ICE3({ backend }), {
    fetch,
    camera: overviewCamera(),
  }).open('https://example.test/spatial-demo/tileset.json');
  await tileset.whenReady();
  const internals = tileset as unknown as {
    resident: Map<string, { container: ICENode }>;
    workSet: { retainIds: Set<string> };
    lodSelection: {
      target: [];
      prefetch: [];
      fallbackByTargetId: Map<string, string>;
    };
    visibleCoverageIds: Set<string>;
    promoteReadyVisibleTargets(): void;
  };
  const previousId = [...internals.resident.keys()][0]!;
  const previous = internals.resident.get(previousId)!;
  previous.container.visible = false;
  internals.visibleCoverageIds = new Set([previousId]);
  internals.workSet = { retainIds: new Set([previousId]) };
  internals.lodSelection = {
    target: [],
    prefetch: [],
    fallbackByTargetId: new Map(),
  };

  internals.promoteReadyVisibleTargets();

  expect(previous.container.visible).toBe(true);
  tileset.dispose();
});

it('reports the selected LOD cut and SSE threshold', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: camera(),
    maxScreenSpaceErrorPixels: 24,
  }).open('https://example.test/spatial-demo/tileset.json');

  await expect.poll(() => tileset.stats.lod.target).toBeGreaterThan(0);
  expect(tileset.stats.lod.maxScreenSpaceErrorPixels).toBe(24);
  expect(tileset.stats.lod.fallback).toBeGreaterThanOrEqual(0);
});

it('rejects an invalid SSE threshold', () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });

  expect(() => new ICETilesetLoader(engine, {
    camera: camera(),
    maxScreenSpaceErrorPixels: 0,
  })).toThrow(/ICE3_TILESET_LOD_INVALID/);
});

it('rejects invalid adaptive batching options', () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });

  expect(() => new ICETilesetLoader(engine, {
    camera: camera(),
    renderBatching: {
      mode: 'adaptive',
      maxWorkers: 0,
    },
  })).toThrow(/ICE3_TILESET_INVALID/);
});

it('keeps successful tiles after one tile fails', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    if (url.endsWith('part-000.glb')) {
      return new Response('broken', { status: 500 });
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: overviewCamera(),
  })
    .open('https://example.test/spatial-demo/tileset.json');

  await tileset.whenIdle();
  expect(tileset.stats.loaded).toBe(3);
  expect(tileset.stats.failed).toBe(1);
  expect(tileset.scene.children.length).toBeGreaterThan(0);
});

it('rejects duplicate node IDs from a later tile without removing earlier tiles', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    const name = url.endsWith('part-001.glb')
      ? 'part-000.glb'
      : url.split('/').at(-1)!;
    return new Response(fixture(`parts/${name}`));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: overviewCamera(),
  })
    .open('https://example.test/spatial-demo/tileset.json');

  await tileset.whenIdle();
  expect(tileset.stats.loaded).toBe(3);
  expect(tileset.stats.failed).toBe(1);
  expect(tileset.scene.children.length).toBeGreaterThan(0);
});

it('starts no more than two tile requests before a response settles', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  let inFlight = 0;
  let maximumInFlight = 0;
  const fetch = mockApi.fn((
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => new Promise<Response>((resolve, reject) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      resolve(new Response(fixture('tileset.json')));
      return;
    }
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    init?.signal?.addEventListener('abort', () => {
      inFlight -= 1;
      reject(new DOMException('Aborted', 'AbortError'));
    });
  }));
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: overviewCamera(),
  })
    .open('https://example.test/spatial-demo/tileset.json');

  await Promise.resolve();
  expect(inFlight).toBe(2);
  expect(maximumInFlight).toBe(2);
  tileset.dispose();
  await Promise.resolve();
  expect(inFlight).toBe(0);
});

it('aborts pending work and disposes its scene idempotently', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = mockApi.fn((
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => new Promise<Response>((resolve, reject) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      resolve(new Response(fixture('tileset.json')));
      return;
    }
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'));
    });
  }));
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: camera(),
  })
    .open('https://example.test/spatial-demo/tileset.json');

  tileset.dispose();
  tileset.dispose();
  expect(tileset.scene.children).toHaveLength(0);
  expect(tileset.stats.loading).toBe(0);
});

it('removes the caller abort listener when the handle is disposed', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const controller = new AbortController();
  const remove = mockApi.spyOn(controller.signal, 'removeEventListener');
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: camera(),
  }).open(
    'https://example.test/spatial-demo/tileset.json',
    { signal: controller.signal },
  );

  tileset.dispose();
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});

it('uses one removable container per committed partition', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: camera(),
  }).open('https://example.test/spatial-demo/tileset.json');

  await tileset.whenIdle();
  expect(tileset.scene.children).toHaveLength(tileset.stats.resident);
  expect(tileset.scene.children.every((node) => (
    node.id.startsWith('spatial-demo:tile:')
  ))).toBe(true);
});

it('unloads a partition after the camera leaves it', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const orbitCamera = new ICEPerspectiveCamera({
    id: 'camera',
    fov: 25,
    near: 0.1,
    far: 1000,
    position: [0, 0, 8],
    target: [0, 0, 0],
  });
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: orbitCamera,
    maxConcurrentTiles: 1,
    maxResidentTiles: 2,
  }).open('https://example.test/spatial-demo/tileset.json');
  await tileset.whenIdle();
  const initialIds = [...tileset.scene.children].map((node) => node.id);

  orbitCamera.setTarget([12, 0, 0]).setPosition([12, 0, 8]);
  engine.trigger('AFTER_RENDER');
  await expect.poll(() => (
    [...tileset.scene.children].map((node) => node.id)
  )).not.toEqual(initialIds);
  expect(tileset.stats.evicted).toBeGreaterThan(0);
});

it('does not extend an older idle wait after the camera changes', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const orbitCamera = new ICEPerspectiveCamera({
    id: 'camera',
    fov: 25,
    near: 0.1,
    far: 1000,
    position: [0, 0, 8],
    target: [0, 0, 0],
  });
  const fetch = mockApi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return Promise.resolve(new Response(fixture('tileset.json')));
    }
    return new Promise<Response>(() => {});
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: orbitCamera,
    maxConcurrentTiles: 1,
  }).open('https://example.test/spatial-demo/tileset.json');
  await expect.poll(() => tileset.stats.loading).toBe(1);
  const oldIdle = tileset.whenIdle();

  orbitCamera.setTarget([30, 0, 0]).setPosition([30, 0, 8]);
  engine.trigger('AFTER_RENDER');

  await expect(oldIdle).resolves.toBeUndefined();
  tileset.dispose();
});

it('keeps all visible tiles when the soft resident budget is exceeded', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const orbitCamera = new ICEPerspectiveCamera({
    id: 'camera',
    fov: 60,
    near: 0.1,
    far: 1000,
    position: [15, 0, 50],
    target: [15, 0, 0],
  });
  const diagnostics: string[] = [];
  engine.on<{ code: string }>('DIAGNOSTIC', (event) => {
    if (event.param) diagnostics.push(event.param.code);
  });
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: orbitCamera,
    maxResidentTiles: 1,
  }).open('https://example.test/spatial-demo/tileset.json');

  await tileset.whenIdle();
  expect(tileset.stats.visible).toBe(4);
  expect(tileset.stats.resident).toBe(4);
  expect(diagnostics).toContain('ICE3_TILESET_RESIDENT_BUDGET_EXCEEDED');
});

it('does not request offscreen leaf content outside the LOD target', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const orbitCamera = new ICEPerspectiveCamera({
    id: 'camera',
    fov: 25,
    near: 0.1,
    far: 1000,
    position: [0, 0, 8],
    target: [0, 0, 0],
  });
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: orbitCamera,
    prefetchMarginRatio: 0.8,
    unloadMarginRatio: 0.9,
  }).open('https://example.test/spatial-demo/tileset.json');

  await tileset.whenIdle();
  expect(tileset.stats.loaded).toBeGreaterThan(0);
  expect(tileset.stats.failed).toBe(0);
  const glbRequests = fetch.mock.calls.filter(([input]) => (
    !String(input).endsWith('tileset.json')
  ));
  expect(glbRequests.length).toBeLessThanOrEqual(1);
  expect(engine.getDiagnostics().lastDiagnostic?.code)
    .not.toBe('ICE3_TILESET_TILE_FAILED');
});

it('commits one logical container after all tile contents finish', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(multiContentTileset());
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: camera(),
  }).open('https://example.test/spatial-demo/tileset.json');
  await tileset.whenReady();

  expect(tileset.scene.children).toHaveLength(1);
  expect(tileset.scene.children[0]!.children).toHaveLength(2);
  expect(tileset.stats.resident).toBe(1);
  expect(tileset.stats.residentContents).toBe(2);
});

it('discards every staged chunk when one logical tile content fails', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(multiContentTileset());
    }
    if (url.endsWith('part-001.glb')) {
      return new Response('unavailable', { status: 500 });
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: overviewCamera(),
  }).open('https://example.test/spatial-demo/tileset.json');

  engine.trigger('AFTER_RENDER');
  await expect.poll(() => fetch.mock.calls.length).toBeGreaterThan(2);
  await expect.poll(() => tileset.tileState('root')).toBe('failed');
  await tileset.whenIdle();

  expect(
    tileset.scene.findByID('multi-content-demo:tile:root'),
  ).toBeUndefined();
  expect(tileset.stats.failed).toBe(1);
  expect(tileset.stats.loadingContents).toBe(0);
});

it('clears every chunk URL before reloading a logical tile', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const orbitCamera = overviewCamera();
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(multiContentTileset());
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: orbitCamera,
  }).open('https://example.test/spatial-demo/tileset.json');
  engine.trigger('AFTER_RENDER');
  await expect.poll(() => fetch.mock.calls.length).toBeGreaterThan(1);
  await tileset.whenIdle();
  const requestsFor = (path: string): number => fetch.mock.calls.filter(
    ([input]) => String(input).endsWith(path),
  ).length;
  expect(requestsFor('part-000.glb')).toBe(1);
  expect(requestsFor('part-001.glb')).toBe(1);

  orbitCamera.setPosition([1015, 0, 50]).setTarget([1000, 0, 0]);
  engine.trigger('AFTER_RENDER');
  await tileset.whenIdle();
  await expect.poll(() => tileset.scene.children.length).toBe(0);

  orbitCamera.setPosition([15, 0, 50]).setTarget([15, 0, 0]);
  engine.trigger('AFTER_RENDER');
  await expect.poll(() => tileset.stats.residentContents).toBe(2);

  expect(requestsFor('part-000.glb')).toBe(2);
  expect(requestsFor('part-001.glb')).toBe(2);
});

it('does not retain offscreen prefetch beyond the resident tile budget', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const orbitCamera = new ICEPerspectiveCamera({
    id: 'camera',
    fov: 25,
    near: 0.1,
    far: 1000,
    position: [0, 0, 8],
    target: [0, 0, 0],
  });
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: orbitCamera,
    maxConcurrentTiles: 1,
    maxResidentTiles: 1,
    prefetchMarginRatio: 0.8,
    unloadMarginRatio: 0.9,
  }).open('https://example.test/spatial-demo/tileset.json');

  await tileset.whenIdle();

  expect(tileset.stats.visible).toBeGreaterThan(0);
  expect(tileset.stats.resident).toBe(tileset.stats.visible);
  expect(tileset.scene.children).toHaveLength(tileset.stats.visible);
});

it('resolves whenIdle after an unchanged render settles queued bookkeeping', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: camera(),
  }).open('https://example.test/spatial-demo/tileset.json');
  await tileset.whenIdle();

  engine.trigger('AFTER_RENDER');
  const outcome = await Promise.race([
    tileset.whenIdle().then(() => 'idle' as const),
    new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), 50);
    }),
  ]);

  expect(outcome).toBe('idle');
});

it('waits for an in-flight tile that becomes current again', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const orbitCamera = new ICEPerspectiveCamera({
    id: 'camera',
    fov: 25,
    near: 0.1,
    far: 1000,
    position: [0, 0, 8],
    target: [0, 0, 0],
  });
  let resolveTile!: (response: Response) => void;
  const fetch = mockApi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return Promise.resolve(new Response(fixture('tileset.json')));
    }
    return new Promise<Response>((resolve) => {
      resolveTile = resolve;
    });
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: orbitCamera,
    maxConcurrentTiles: 1,
  }).open('https://example.test/spatial-demo/tileset.json');
  await expect.poll(() => tileset.stats.loading).toBe(1);

  orbitCamera.setTarget([30, 0, 0]).setPosition([30, 0, 8]);
  engine.trigger('AFTER_RENDER');
  await expect.poll(() => tileset.tileState('root/0/0')).toBe('evicted');

  orbitCamera.setTarget([0, 0, 0]).setPosition([0, 0, 8]);
  engine.trigger('AFTER_RENDER');
  await Promise.resolve();

  let idleSettled = false;
  const idle = tileset.whenIdle().then(() => {
    idleSettled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  try {
    expect(idleSettled).toBe(false);
  } finally {
    resolveTile(new Response(fixture('parts/part-000.glb')));
  }
  await idle;
  expect(tileset.stats.resident).toBeGreaterThan(0);
});

it('clears a selected descendant when the whole Tileset is disposed', async () => {
  const engine = new ICE3({ backend: new FakeRendererBackend() });
  const fetch = mockApi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('tileset.json')) {
      return new Response(fixture('tileset.json'));
    }
    return new Response(fixture(`parts/${url.split('/').at(-1)!}`));
  });
  const tileset = await new ICETilesetLoader(engine, {
    fetch,
    camera: camera(),
  }).open('https://example.test/spatial-demo/tileset.json');
  await tileset.whenIdle();
  const findMesh = (node: ICENode): ICEMesh | undefined => {
    if (node instanceof ICEMesh) return node;
    for (const child of node.children) {
      const mesh = findMesh(child);
      if (mesh) return mesh;
    }
  };
  const mesh = findMesh(tileset.scene);
  if (!mesh) throw new Error('Expected a loaded mesh');
  engine.setScene(tileset.scene).setSelection([mesh.id]);

  tileset.dispose();

  expect(engine.getSelection()).toEqual([]);
});
