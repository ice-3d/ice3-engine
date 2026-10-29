# ICE3 Engine Asset 加载

> Document ID: ICE3-ENG-GUIDE-002
>
> Status: Active
>
> Owner: ICE3 Engine maintainers

## 目标结果

打开带 ICE3 Prepared profile 的标准 GLB，或受支持的本地 OGC 3D Tiles 1.1 Tileset，
并让 Scene、network 和 GPU resource 保持有界。

## 前置条件

- 由 `ice3-toolchain` 生成的文件。
- 拥有当前视图的 PerspectiveCamera。
- Example 中的 Asset 文件从同源地址提供。

## 打开 Prepared GLB

```ts
import { ICE3, ICEAssetLoader, ICEPerspectiveCamera } from 'ice3';

const host = document.querySelector<HTMLElement>('#stage');
if (!host) throw new Error('stage element is required');

const engine = new ICE3().init(host);
const camera = new ICEPerspectiveCamera({
  id: 'camera',
  position: [3, 2, 4],
  target: [0, 0, 0],
});
const loader = new ICEAssetLoader(engine);
const handle = await loader.open('/assets/device.glb');

engine.setScene(handle.scene).setCamera(camera).start();
```

## 打开 Tileset

Toolchain 的 `partition` 输出目录应作为一个整体发布。例如输出被复制到静态目录
`assets/plant/` 后，需要保留 `tileset.json`、`parts/` 和 `coarse/` 的相对层级，
并按 `/assets/plant/tileset.json` 加载。

```ts
import {
  ICEOrbitController,
  ICETilesetLoader,
} from 'ice3';

const orbit = new ICEOrbitController(engine, camera).start();
const loader = new ICETilesetLoader(engine, {
  camera,
  maxConcurrentTiles: 2,
  maxCommitsPerFrame: 1,
  maxScreenSpaceErrorPixels: 16,
});
const handle = await loader.open('/assets/plant/tileset.json');
engine.setScene(handle.scene).setCamera(camera).start();
await handle.whenReady();
await handle.whenIdle();

handle.dispose();
orbit.dispose();
```

`open()` 不等待全部 GLB。`whenReady()` 在首个 coverage content 提交后 resolve，
`whenIdle()` 等待当前 camera work set。Camera-driven Scene 不会同时保留所有 Tile，
因此不定义 `whenComplete()`。

## 生命周期

- Prepared GLB 和 Tileset 的 Scene 使用期间都必须保持对应 handle alive。
- 不再需要时调用各自的 `handle.dispose()`；该操作是幂等的。
- 单 GLB 的 active Scene 被释放或不再需要后，才可使用对应的 `ICEAssetLoader.clear(url)`
  清除 cached decoded bytes。
- Tileset lifecycle 由其 `ICETilesetHandle` 管理，不调用 `ICETilesetLoader.clear()`。
- Refinement 失败不移除 last-known-complete coverage。

## 预期结果

- 无效 profile 在部分 Scene 出现前失败。
- 完成 partition 原子变为可见。
- Selected equipment identity 在 LOD replacement 后继续保留。
- Resident Tile count 和 GPU bytes 可从 Diagnostic 读取。

## 关联文档

- `ICE3-ENG-API-002` — [M1 Asset API 参考](../api/m1.md)
- `ICE3-ENG-REF-001` — [Diagnostic 参考](../diagnostics.md)
- `ICE3-TOOL-GUIDE-003` — [从 GLB 到 Engine 的完整接入流程](https://github.com/ice-3d/ice3-toolchain/blob/main/docs/guides/glb-to-engine.md)
- `ICE3-DOC-CTR-001` — [Asset Preparation Contract v1 契约](https://github.com/ice-3d/ice3-doc/blob/main/docs/contracts/asset-preparation-contract-v1.md)
