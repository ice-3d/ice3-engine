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

```ts
import { ICETilesetLoader } from 'ice3';

const tileset = new ICETilesetLoader(engine, {
  camera,
  maxConcurrentRequests: 2,
  commitPerFrame: 1,
});
const handle = await tileset.open('/assets/plant/tileset.json');
engine.setScene(handle.scene);
await handle.whenIdle();
```

使用 `whenIdle()` 等待当前 camera work set。Camera-driven Scene 不会同时保留所有
Tile，因此不定义 `whenComplete()`。

## 生命周期

- Scene 使用期间保持 handle alive。
- Asset 不再需要时调用 `handle.dispose()`。
- 只有 active Scene instance 被释放或不再需要后，才使用 `loader.clear(url)` 清除
  cached decoded bytes。
- Refinement 失败不移除 last-known-complete coverage。

## 预期结果

- 无效 profile 在部分 Scene 出现前失败。
- 完成 partition 原子变为可见。
- Selected equipment identity 在 LOD replacement 后继续保留。
- Resident Tile count 和 GPU bytes 可从 Diagnostic 读取。

## 关联文档

- `ICE3-ENG-API-002` — [M1 Asset API 参考](../api/m1.md)
- `ICE3-ENG-REF-001` — [Diagnostic 参考](../diagnostics.md)
- `ICE3-DOC-CTR-001` — [Asset Preparation Contract v1 契约](https://github.com/ice-3d/ice3-doc/blob/main/docs/contracts/asset-preparation-contract-v1.md)
